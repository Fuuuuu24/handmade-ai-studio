import { Suspense } from 'react';
import { PageLoading } from '@/components/pages/page-frame';
import { HistoryPage } from '@/components/pages/history-page';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <HistoryPage />
    </Suspense>
  );
}
