"use client";

export default function NewsletterForm() {
  return (
    <form
      className="flex w-full max-w-xl flex-col gap-3 sm:flex-row"
      onSubmit={(e) => e.preventDefault()}
    >
      <input
        type="email"
        placeholder="Enter your email"
        className="pkc-input flex-1"
      />
      <button type="submit" className="pkc-button-accent sm:min-w-[10rem]">
        Subscribe
      </button>
    </form>
  );
}
