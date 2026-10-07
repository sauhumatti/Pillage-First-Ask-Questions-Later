import { clsx } from 'clsx';
import { use, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuClock3, LuPause, LuPlay, LuShieldCheck } from 'react-icons/lu';
import { useServer } from 'app/(game)/(village-slug)/hooks/use-server';
import { ApiContext } from 'app/(game)/providers/api-context';
import { setSimulationTime } from 'app/(game)/utils/timer';
import { Button } from 'app/components/ui/button';

export const SimulationControls = () => {
  const { t } = useTranslation();
  const { mapSize } = useServer();
  const { apiClient } = use(ApiContext);
  const [rate, setRate] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (mapSize !== 50) {
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const { data } = await apiClient.get('/simulation');
        if (disposed) {
          return;
        }
        setRate(data.rate);
        setWaiting(data.waitingForAi);
        setSimulationTime(data.now);
      } catch {
        if (!disposed) {
          setError(t('Could not read game time'));
        }
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 250);
    return () => {
      disposed = true;
      clearInterval(timer);
      setSimulationTime(null);
    };
  }, [apiClient, mapSize, t]);
  if (mapSize !== 50) {
    return null;
  }
  const changeRate = async (value: 0 | 1 | 2 | 5 | 10) => {
    try {
      const { data } = await apiClient.patch('/simulation', {
        body: { rate: value },
      });
      setError('');
      setRate(data.rate);
      setSimulationTime(data.now);
    } catch {
      setError(t('Could not change playback speed'));
    }
  };
  return (
    <fieldset
      className="simulation-bar"
      aria-label={t('Game playback')}
    >
      <div className="simulation-bar-inner">
        <div className="flex items-center gap-3">
          <LuClock3
            className="hidden size-5 text-emerald-200/70 sm:block"
            aria-hidden="true"
          />
          <div className="flex items-center gap-2 text-sm font-medium">
            <span
              className={clsx(
                'size-2 rounded-full',
                rate === 0 ? 'bg-amber-300' : 'bg-emerald-300',
              )}
              aria-hidden="true"
            />
            <span className="sm:min-w-19">
              {rate === 0
                ? t('Paused')
                : t('{{speed}}× speed', { speed: rate })}
            </span>
          </div>
        </div>
        <div className="playback-buttons flex items-center gap-1 rounded-xl p-1">
          {([0, 1, 2, 5, 10] as const).map((value) => (
            <Button
              key={value}
              className="playback-button min-w-8 rounded-lg px-2 shadow-none sm:min-w-10"
              size="sm"
              variant="ghost"
              aria-pressed={rate === value}
              title={
                value === 0
                  ? t('Pause')
                  : t('Play at {{speed}}× speed', { speed: value })
              }
              onClick={() => void changeRate(value)}
            >
              {value === 0 ? (
                <>
                  <LuPause aria-hidden="true" />
                  <span className="hidden sm:inline">{t('Pause')}</span>
                </>
              ) : (
                <>
                  {value === 1 && (
                    <LuPlay
                      className="hidden sm:block"
                      aria-hidden="true"
                    />
                  )}
                  {value}×
                </>
              )}
              {value === 0 && (
                <span className="sr-only sm:hidden">{t('Pause')}</span>
              )}
            </Button>
          ))}
        </div>
        <span className="hidden items-center gap-2 text-xs text-emerald-100/75 md:inline-flex">
          {waiting ? (
            <LuClock3 aria-hidden="true" />
          ) : (
            <LuShieldCheck aria-hidden="true" />
          )}
          {waiting ? t('AI is deciding…') : t('The world pauses while closed.')}
        </span>
      </div>
      {error && (
        <span
          className="block px-4 pb-2 text-center text-sm text-amber-200"
          role="alert"
        >
          {error}
        </span>
      )}
    </fieldset>
  );
};
