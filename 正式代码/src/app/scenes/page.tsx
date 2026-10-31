import { Suspense } from 'react';
import { PageLoading } from '@/components/pages/page-frame';
import { ScenesPage } from '@/components/pages/scenes-page';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ScenesPage />
    </Suspense>
  );
}
