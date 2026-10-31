import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '一间 · 手作影像工作台',
  description: '理解手作故事，帮助独立手作商家制作真实、有个人风格的电商商品主图',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
