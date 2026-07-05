import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';

// App-Shell. Die Feature-Routen (Login, Dienstpläne, Personen, …) kommen
// mit den jeweiligen Modulen dazu – hier steht bewusst nur das Gerüst.
export default function App() {
  const { t } = useTranslation();

  return (
    <Routes>
      <Route
        path="*"
        element={
          <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-4">
            <h1 className="text-3xl font-bold">{t('common.appName')}</h1>
            <p className="text-gray-500">{t('common.loading')}</p>
          </main>
        }
      />
    </Routes>
  );
}
