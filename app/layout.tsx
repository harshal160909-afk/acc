import type { Metadata } from "next";
import { headers } from "next/headers";
import "./acc.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "ACC — Your personal AI accountant",
    description: "A personal AI accountant that makes business money easy to understand.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "ACC — Your personal AI accountant",
      description: "See where your business money comes from, where it goes, and what it means.",
      type: "website",
      images: [{ url: image, alt: "ACC visual money map for Indian businesses" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ACC",
      description: "Your business money, explained simply.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-IN"><body>{children}</body></html>;
}
