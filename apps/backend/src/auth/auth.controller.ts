import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { AuthService } from './auth.service';
import type { TelegramAuthPayload } from './auth.service';
import { ClientDevice } from './client-device.decorator';
import type { ClientDeviceInfo } from './client-device.decorator';
import { LoginDevicesService } from './login-devices.service';
import { LoginDto } from './dto/login.dto';
import { LoginOtpDto } from './dto/login-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { LinkSocialProviderDto } from './dto/link-social-provider.dto';

// Per-route limits on top of the global 100/min. Every route here is @Public,
// so the throttler keys on IP: these bound password guessing (login,
// otp/login, otp/verify) and SMS pumping (register, otp/request, otp/login —
// each call sends a paid SMS).
const SMS_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginDevices: LoginDevicesService,
  ) {}

  @Post('login')
  @Throttle(CREDENTIAL_LIMIT)
  @Public()
  @ApiOperation({ summary: 'Login with username/phone + password' })
  login(
    @Body() dto: LoginDto,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.authService.loginWithPassword(dto, device);
  }

  @Post('register')
  @Throttle(SMS_LIMIT)
  @Public()
  @ApiOperation({ summary: 'Register with phone number (sends OTP)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.registerWithPhone(dto);
  }

  @Post('otp/request')
  @Throttle(SMS_LIMIT)
  @Public()
  @ApiOperation({ summary: 'Request OTP for phone' })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestPhoneOtp(dto.phone);
  }

  @Post('otp/login')
  @Throttle(SMS_LIMIT)
  @Public()
  @ApiOperation({
    summary: 'Login with phone + password (validates password, then sends OTP)',
  })
  requestLoginOtp(@Body() dto: LoginOtpDto) {
    return this.authService.requestLoginOtp(dto);
  }

  @Post('otp/verify')
  @Throttle(CREDENTIAL_LIMIT)
  @Public()
  @ApiOperation({ summary: 'Verify phone OTP and get tokens' })
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.authService.verifyPhoneOtp(dto, device);
  }

  @Get('social/:provider/url')
  @Public()
  @ApiOperation({ summary: 'Get OAuth redirect URL for social provider' })
  socialUrl(
    @Param('provider') provider: string,
    @Query('redirectTo') redirectTo?: string,
  ) {
    return this.authService.getSocialAuthUrl(provider, redirectTo);
  }

  @Post('social/callback')
  // No per-route bucket on purpose: the web exchanges the Supabase token from
  // a Next server action, so every user arrives from the same Next/Vercel
  // egress IP and CREDENTIAL_LIMIT would cap all logins together. The
  // Supabase access token is the gate; the global limiter still applies.
  @Public()
  @ApiOperation({ summary: 'Handle social OAuth callback' })
  socialCallback(
    @Body() dto: SocialLoginDto,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.authService.handleSocialCallback(dto, device);
  }

  @Post('social/link')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link a social provider to the current account' })
  linkSocial(
    @CurrentUser() user: RequestUser,
    @Body() dto: LinkSocialProviderDto,
  ) {
    return this.authService.linkSocialProvider(user.id, dto);
  }

  @Delete('social/:provider')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unlink a social provider from the current account',
  })
  unlinkSocial(
    @CurrentUser() user: RequestUser,
    @Param('provider') provider: string,
  ) {
    return this.authService.unlinkSocialProvider(user.id, provider);
  }

  @Post('telegram')
  @Throttle(CREDENTIAL_LIMIT)
  @Public()
  @ApiOperation({ summary: 'Login via Telegram widget' })
  telegramLogin(
    @Body() payload: TelegramAuthPayload,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.authService.loginWithTelegram(payload, device);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(
    @Body() dto: RefreshDto,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.authService.refresh(dto, device);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: RequestUser) {
    return this.authService.findById(user.id);
  }

  @Get('devices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the active login devices' })
  listDevices(
    @CurrentUser() user: RequestUser,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.loginDevices.listActive(user.id, {
      sessionId: user.sessionId ?? null,
      deviceId: device?.id ?? null,
    });
  }

  @Delete('devices/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke one other login device' })
  revokeDevice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.loginDevices.revoke(user.id, id, {
      sessionId: user.sessionId ?? null,
      deviceId: device?.id ?? null,
    });
  }

  @Post('devices/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every other login device' })
  revokeOtherDevices(
    @CurrentUser() user: RequestUser,
    @ClientDevice() device: ClientDeviceInfo | null,
  ) {
    return this.loginDevices.revokeOthers(user.id, {
      sessionId: user.sessionId ?? null,
      deviceId: device?.id ?? null,
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current login session' })
  logout(@CurrentUser() user: RequestUser) {
    return this.loginDevices.revokeSession(user.id, user.sessionId ?? null);
  }
}
