// 'use client'

// import type React from 'react';
// import { useState } from 'react';
// import { Eye, EyeOff, AlertCircle } from 'lucide-react';
// import { useRouter } from 'next/navigation';
// import Link from "next/link";

// export  function RegisterForm() {
//   const [formData, setFormData] = useState({
//     firstName: '',
//     lastName: '',
//     phoneNumber: '',
//     password: '',
//     confirmPassword: '',
//   });
//   const [showPassword, setShowPassword] = useState(false);
//   const [showConfirmPassword, setShowConfirmPassword] = useState(false);
//   const [errors, setErrors] = useState({
//     firstName: false,
//     lastName: false,
//     phoneNumber: false,
//     password: false,
//     confirmPassword: false,
//   });
//   const router = useRouter();

//   const handleChange = (field: string, value: string) => {
//     setFormData({ ...formData, [field]: value });
//     setErrors({ ...errors, [field]: false });
//   };

//   const handleSubmit = (e: React.FormEvent) => {
//     e.preventDefault();

//     const newErrors = {
//       firstName: !formData.firstName.trim(),
//       lastName: !formData.lastName.trim(),
//       phoneNumber: !formData.phoneNumber.trim(),
//       password: !formData.password.trim(),
//       confirmPassword: !formData.confirmPassword.trim() || formData.password !== formData.confirmPassword,
//     };

//     setErrors(newErrors);

//     if (!Object.values(newErrors).some((error) => error)) {
//       console.log('Registration submitted:', formData);
//     }
//   };

//   const handleSocialLogin = (provider: 'facebook' | 'google') => {
//     const width = 600;
//     const height = 700;
//     const left = window.screenX + (window.outerWidth - width) / 2;
//     const top = window.screenY + (window.outerHeight - height) / 2;

//     const authUrls = {
//       facebook: 'https://www.facebook.com/login',
//       google: 'https://accounts.google.com/signin',
//     };

//     window.open(
//       authUrls[provider],
//       `${provider}-login`,
//       `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
//     );
//   };

//   const OrDivider = () => (
//     <div className="relative my-4">
//       <div className="absolute inset-0 flex items-center">
//         <div className="w-full border-t border-border"></div>
//       </div>
//       <div className="relative flex justify-center type-body-sm">
//         <span className="px-2 bg-background text-foreground">Or</span>
//       </div>
//     </div>
//   );

//   return (
//     <div className=" pt-6 pb-30 px-4">

//       <div className="w-full max-w-[580px] mx-auto bg-card rounded-sm shadow-sm border border-border p-8">
//       <div className="mb-6">
//         <h1 className="type-page-title text-center mb-4 text-foreground">
//           Register to post free ad
//         </h1>
//         <div className="border-b border-border w-full">

//         </div>
//         </div>

//         <form onSubmit={handleSubmit} className="space-y-6">
//           {/* First Name Field */}
//           <div>
//           <label
//               htmlFor="username"
//               className="block type-nav text-foreground mb-4"
//             >
//               First Name <span className="text-red-500">*</span>
//             </label>
//             <div className="relative">
//               <input
//                 id="firstName"
//                 type="text"
//                 value={formData.firstName}
//                 onChange={(e) => handleChange('firstName', e.target.value)}
//                 className={`w-full px-3 py-2 bg-blue-50/50 border rounded ${
//                   errors.firstName
//                     ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
//                     : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
//                 } focus:outline-none focus:ring-1 transition-colors type-body-sm`}
//                 placeholder=""
//               />
//               {errors.firstName && (
//                 <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
//               )}
//             </div>
//             {errors.firstName && <p className="text-red-500 type-meta mt-1">Please enter your first name</p>}
//           </div>

//           {/* Last Name Field */}
//           <div>
//             <label htmlFor="lastName" className="block type-meta font-medium text-foreground mb-1">
//               Last Name <span className="text-red-500">*</span>
//             </label>
//             <div className="relative">
//               <input
//                 id="lastName"
//                 type="text"
//                 value={formData.lastName}
//                 onChange={(e) => handleChange('lastName', e.target.value)}
//                 className={`w-full px-3 py-2 bg-blue-50/50 border rounded ${
//                   errors.lastName
//                     ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
//                     : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
//                 } focus:outline-none focus:ring-1 transition-colors type-body-sm`}
//                 placeholder=""
//               />
//               {errors.lastName && (
//                 <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
//               )}
//             </div>
//             {errors.lastName && <p className="text-red-500 type-meta mt-1">Please enter your last name</p>}
//           </div>

//           {/* Phone Number Field */}
//           <div>
//             <label htmlFor="phoneNumber" className="block type-meta font-medium text-foreground mb-1">
//               Phone Number <span className="text-red-500">*</span>
//             </label>
//             <div className="relative">
//               <input
//                 id="phoneNumber"
//                 type="tel"
//                 value={formData.phoneNumber}
//                 onChange={(e) => handleChange('phoneNumber', e.target.value)}
//                 className={`w-full px-3 py-2 bg-blue-50/50 border rounded ${
//                   errors.phoneNumber
//                     ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
//                     : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
//                 } focus:outline-none focus:ring-1 transition-colors type-body-sm`}
//                 placeholder=""
//               />
//               {errors.phoneNumber && (
//                 <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
//               )}
//             </div>
//             {errors.phoneNumber && <p className="text-red-500 type-meta mt-1">Please enter the 'Phone Number'</p>}
//           </div>

//           {/* Password Field */}
//           <div>
//             <label htmlFor="password" className="block type-meta font-medium text-foreground mb-1">
//               Password <span className="text-red-500">*</span>
//             </label>
//             <div className="relative">
//               <input
//                 id="password"
//                 type={showPassword ? 'text' : 'password'}
//                 value={formData.password}
//                 onChange={(e) => handleChange('password', e.target.value)}
//                 className={`w-full px-3 py-2 bg-blue-50/50 border rounded ${
//                   errors.password
//                     ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
//                     : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
//                 } focus:outline-none focus:ring-1 transition-colors type-body-sm`}
//                 placeholder=""
//               />
//               <button
//                 type="button"
//                 onClick={() => setShowPassword(!showPassword)}
//                 className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground hover:text-gray-700"
//               >
//                 {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
//               </button>
//             </div>
//             {errors.password && <p className="text-red-500 type-meta mt-1">Please enter your password</p>}
//           </div>

//           {/* Confirm Password Field */}
//           <div>
//             <label htmlFor="confirmPassword" className="block type-meta font-medium text-foreground mb-1">
//               Confirm Password <span className="text-red-500">*</span>
//             </label>
//             <div className="relative">
//               <input
//                 id="confirmPassword"
//                 type={showConfirmPassword ? 'text' : 'password'}
//                 value={formData.confirmPassword}
//                 onChange={(e) => handleChange('confirmPassword', e.target.value)}
//                 className={`w-full px-3 py-2 bg-blue-50/50 border rounded ${
//                   errors.confirmPassword
//                     ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
//                     : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
//                 } focus:outline-none focus:ring-1 transition-colors type-body-sm`}
//                 placeholder=""
//               />
//               <button
//                 type="button"
//                 onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//                 className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground hover:text-gray-700"
//               >
//                 {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
//               </button>
//             </div>
//             {errors.confirmPassword && <p className="text-red-500 type-meta mt-1">Please enter the confirm password</p>}
//           </div>

//           {/* Submit Button */}
//           <button
//             type="submit"
//             className="w-full bg-[#ff8c00] hover:bg-[#e67e00] text-white font-medium py-2 rounded transition-colors type-body-sm"
//           >
//             Submit
//           </button>
//         </form>

//         {/* First "Or" Divider */}
//         <OrDivider />

//         {/* Social Login Buttons */}
//         <div className="flex justify-center gap-3 mb-4">
//           <button
//             type="button"
//             onClick={() => handleSocialLogin('facebook')}
//             aria-label="Register with Facebook"
//             className="w-12 h-12 bg-[#1877f2] hover:bg-[#166fe5] text-white rounded-full flex items-center justify-center transition-colors"
//           >
//             <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
//               <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
//             </svg>
//           </button>
//           <button
//             type="button"
//             onClick={() => handleSocialLogin('google')}
//             aria-label="Register with Google"
//             className="w-12 h-12 bg-white hover:bg-gray-50 border-2 border-gray-300 rounded-full flex items-center justify-center transition-colors"
//           >
//             <svg className="w-6 h-6" viewBox="0 0 24 24">
//               <path
//                 fill="#4285F4"
//                 d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
//               />
//               <path
//                 fill="#34A853"
//                 d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
//               />
//               <path
//                 fill="#FBBC05"
//                 d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
//               />
//               <path
//                 fill="#EA4335"
//                 d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
//               />
//             </svg>
//           </button>
//         </div>

//         {/* Second "Or" Divider */}
//         <OrDivider />

//         {/* Login Section */}
//         <div className="text-center mb-3">
//           <p className="type-body-sm text-foreground mb-2">Already have an account?</p>
//           <button
//             type="button"
//             onClick={() => router.push('/login')}
//             className="w-full bg-[#00a7e1] hover:bg-[#0095ca] text-white font-medium py-2 rounded transition-colors type-body-sm"
//           >
//             Log in
//           </button>
//         </div>

//         {/* Terms */}
//         <p className="type-body text-center text-foreground">
//           By continuing, you agree to our{" "}
//           <Link href="/posting-rule" className="text-[#00a7e1] hover:underline">
//             Posting Rule
//           </Link>{" "}
//           and{" "}
//           <Link
//             href="/privacy-policy"
//             className="text-[#00a7e1] hover:underline"
//           >
//             Privacy Policy
//           </Link>
//           .
//         </p>
//       </div>
//     </div>
//   );
// }

"use client";

import { register } from "@/actions/register";
import { storeOtpRegistration } from "@/lib/otp-registration";
import { useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { registerSchema } from "@/schemas/register";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/components/form/hooks";
import { FaTelegramPlane } from "react-icons/fa";

type FormData = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();

  const form = useAppForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      phoneNumber: "",
      password: "",
      confirmPassword: "",
    } satisfies FormData as FormData,
    validators: {
      onSubmit: registerSchema,
      onChange: registerSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await register(value);

      if (res.success) {
        // The password/names reach the verify call via sessionStorage —
        // never through the URL.
        storeOtpRegistration({
          mode: "register",
          phone: res.phone,
          firstName: value.firstName.trim(),
          lastName: value.lastName.trim(),
          password: value.password,
        });
        form.reset();
        toast.success("Code sent to your phone.");
        router.push({ pathname: "/otp", query: { phone: res.phone } });
      } else {
        toast.error(res.error ?? "Failed to send code.");
      }
    },
  });

  return (
    <div className="container px-4 mx-auto my-6 pb-30">
      <div className="w-full max-w-[580px] mx-auto bg-card rounded-sm shadow-sm border border-border p-8">
        <div className="mb-6">
          <h1 className="type-page-title text-center mb-4 text-foreground">
            Register to post free ad
          </h1>
          <FieldSeparator />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField name="firstName">
              {(field) => <field.Input label="First Name" required={true} />}
            </form.AppField>

            <form.AppField name="lastName">
              {(field) => <field.Input label="Last Name" required={true} />}
            </form.AppField>

            <form.AppField name="phoneNumber">
              {(field) => <field.Input label="Phone Number" type="tel" />}
            </form.AppField>

            <form.AppField name="password">
              {(field) => <field.Input label="Password" />}
            </form.AppField>

            <form.AppField name="confirmPassword">
              {(field) => <field.Input label="Confirm Password" />}
            </form.AppField>
            <Button
              type="submit"
              className="bg-orange-500 text-white w-full hover:bg-orange-600 hover:text-white cursor-pointer"
            >
              Submit
            </Button>

            <FieldSeparator>Or</FieldSeparator>
            <Button
              type="button"
              className="bg-sky-600 text-white w-full hover:bg-sky-600 hover:text-white cursor-pointer flex items-center gap-2"
            >
              <FaTelegramPlane className="text-white text-2xl" />
              Sign in or register with Telegram
            </Button>
          </FieldGroup>
        </form>
      </div>
    </div>
  );
}
