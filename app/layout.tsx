import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "기록샘 | 생활기록부 작성 지원",
    description: "평가 근거와 관찰 기록을 바탕으로 교사의 생활기록부 작성을 돕는 안전한 업무 도구",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "기록샘 | 교사의 기록을 더 가치 있게",
      description: "평가 근거부터 최종 검토까지, 한곳에서",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 909, alt: "기록샘 서비스 소개" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "기록샘 | 교사의 기록을 더 가치 있게",
      description: "평가 근거부터 최종 검토까지, 한곳에서",
      images: [`${origin}/og.png`],
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
