import { Suspense } from 'react';
import { PageLoading } from '@/components/pages/page-frame';
import { WorksPage } from '@/components/pages/works-page';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <WorksPage />
    </Suspense>
  );
}
