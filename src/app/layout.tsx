import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prognozy Piłkarskie",
  description: "Zagregowane prognozy meczów piłkarskich z darmowych, publicznych źródeł danych.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>
        <header className="site-header">
          <h1>
            <a href="/">⚽ Prognozy Piłkarskie</a>
          </h1>
          <p>
            Prognozy łączące kursy bukmacherskie z modelem Poissona opartym na rankingu Elo i formie.
            Aktualizowane raz dziennie.
          </p>
        </header>
        {children}
      </body>
    </html>
  );
}
