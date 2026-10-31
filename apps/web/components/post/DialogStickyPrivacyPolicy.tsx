import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DialogStickyPrivacyPolicy() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Privacy Policy</Button>
      </DialogTrigger>
      <DialogContent className="!max-w-[calc(100vw-2rem)] !w-[800px]">
        <DialogHeader>
          <DialogTitle>Privacy Policy</DialogTitle>
          <DialogDescription className="sr-only">
            This dialog has a sticky footer that stays visible while the content
            scrolls.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4">
          <p>
            PhsarKhmer Free Classifieds strives to offer its visitors the many
            advantages of internet technology and to provide an interactive and
            personalized experience. We may use Personally Identifiable
            Information (your name, e-mail address, street address, telephone
            number) subject to the terms of this privacy policy. We will never
            sell, barter, or rent your email address to any unauthorized third
            party.
          </p>
          <p>
            We recognizes the importance of protecting your privacy and our
            policy is designed to assist you in understanding how we collect,
            use and safeguard the personal information you provide to us and to
            assist you in making informed decisions when using our site. This
            policy will be continuously assessed against new technologies,
            business practices and our customers&apos; needs.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
