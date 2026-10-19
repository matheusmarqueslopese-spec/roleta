import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roleta Promocional | Fator Redução",
  description: "Experiência promocional oficial da Fator Redução.",
  icons: { icon: "/assets/fator-icone-transparente.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
