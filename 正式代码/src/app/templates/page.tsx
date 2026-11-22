import { Suspense } from 'react';
import { PageLoading } from '@/components/pages/page-frame';
import { TemplatesPage } from '@/components/pages/templates-page';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TemplatesPage />
    </Suspense>
  );
}
