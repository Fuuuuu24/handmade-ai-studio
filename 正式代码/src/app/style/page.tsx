import { Suspense } from 'react';
import { PageLoading } from '@/components/pages/page-frame';
import { StylePage } from '@/components/pages/style-page';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <StylePage />
    </Suspense>
  );
}
