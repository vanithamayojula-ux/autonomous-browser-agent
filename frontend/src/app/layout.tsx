import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Autonomous AI Browser Agent',
  description: 'AI-Powered Autonomous Web Automation System',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased text-slate-100 bg-slate-950">
        {children}
      </body>
    </html>
  );
}
