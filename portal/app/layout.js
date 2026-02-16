import "./globals.css";

export const metadata = {
  title: "Free WiFi - Connect",
  description: "Connect to free WiFi",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
