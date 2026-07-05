import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Forecast",
  description: "Aggregated football match predictions from free public data sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <h1>
            <a href="/">⚽ Football Forecast</a>
          </h1>
          <p>
            Predictions combining bookmaker market odds and an Elo + form based Poisson model.
            Updated once a day.
          </p>
        </header>
        {children}
      </body>
    </html>
  );
}
