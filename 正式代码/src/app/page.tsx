import { Suspense } from 'react';
import { HomePage } from '@/components/home/home-page';

export default function Page() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-aux text-muted">正在打开…</div>}>
      <HomePage />
    </Suspense>
  );
}
