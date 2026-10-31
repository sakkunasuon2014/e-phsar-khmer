"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {} from "@/components/ui/input-group";
import { SearchIcon, CheckIcon } from "lucide-react";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className,
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  // The search field is autofocused, so the pointer usually sits over it when
  // the user starts scrolling — and a wheel there has no scrollable ancestor
  // inside the panel, so it scrolled the PAGE behind the popover instead of the
  // list (measured: 1000px of page movement, zero list movement). Forward it.
  // React's onWheel is registered passively at the root, so `preventDefault`
  // there is a no-op; this needs a native non-passive listener.
  const wrapRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const panel = wrap?.parentElement;
    if (!wrap || !panel) return;
    const onWheel = (event: WheelEvent) => {
      const list = panel.querySelector<HTMLElement>(
        '[data-slot="command-list"]',
      );
      if (!list || list.scrollHeight <= list.clientHeight) return;
      event.preventDefault();
      list.scrollTop += event.deltaY;
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wrapRef} data-slot="command-input-wrapper" className="p-2">
      <div className="flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 focus-within:ring-2 focus-within:ring-orange-400">
        <SearchIcon className="size-4 shrink-0 text-gray-400" />
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "h-full w-full bg-transparent type-body outline-hidden placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      // `max-h-[296px]` is 6 whole 48px rows plus the list's own 8px padding.
      // The old `max-h-80` (320px) was 6.5 rows, so the 7th row was sliced
      // through the middle at the panel's bottom edge — it read as a broken
      // panel rather than "there is more below".
      // `overscroll-contain` stops the wheel from scrolling the PAGE behind the
      // panel once the list reaches its end (measured: the page jumped 2313px).
      // `no-scrollbar` was removed: it had no CSS definition anywhere, so it did
      // nothing while implying the scrollbar was hidden on purpose.
      className={cn(
        "command-list max-h-[296px] scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain p-1 outline-none",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center type-body-sm", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-3 rounded-md px-3 py-3 type-body-sm outline-hidden select-none text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto type-meta tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
