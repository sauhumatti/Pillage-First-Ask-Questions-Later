import { use, useEffect, useState } from 'react';
import { useServer } from 'app/(game)/(village-slug)/hooks/use-server';
import { ApiContext } from 'app/(game)/providers/api-context';
import { setSimulationTime } from 'app/(game)/utils/timer';
import { Button } from 'app/components/ui/button';

export const SimulationControls = () => {
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
          setError('Could not read game time');
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
  }, [apiClient, mapSize]);
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
      setError('Could not change playback speed');
    }
  };
  return (
    <fieldset
      className="flex flex-wrap items-center justify-center gap-2 border-b p-2"
      aria-label="Game playback"
    >
      <span>{rate === 0 ? 'Paused' : `${rate}× speed`}</span>
      {([0, 1, 2, 5, 10] as const).map((value) => (
        <Button
          key={value}
          size="sm"
          variant={rate === value ? 'default' : 'outline'}
          aria-pressed={rate === value}
          onClick={() => void changeRate(value)}
        >
          {value === 0 ? 'Pause' : `${value}×`}
        </Button>
      ))}
      <span className="text-sm text-muted-foreground">
        {waiting ? 'AI is deciding…' : 'The world pauses while closed.'}
      </span>
      {error && <span role="alert">{error}</span>}
    </fieldset>
  );
};
