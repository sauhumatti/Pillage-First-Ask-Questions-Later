import { Outlet } from 'react-router';
import { initFaro } from 'app/instrumentation/faro';
import { StateProvider } from 'app/providers/state-provider';
import './localization/i18n';
import './styles/app.css';
import type { Route } from '@react-router/types/app/+types/root';
import { GameServerLogin } from 'app/components/game-server-login';
import { WebRTCAdvertiser } from 'app/components/webrtc-advertiser';
import { clientSessionMiddleware } from 'app/middleware/client-session-middleware';
import { isGameServerMode } from 'app/utils/game-server';

await initFaro();

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  clientSessionMiddleware,
];

const App = () => {
  return (
    <StateProvider>
      {/* Sharing worlds between devices isn't needed when the server holds them */}
      {!isGameServerMode && <WebRTCAdvertiser />}
      <Outlet />
      <GameServerLogin />
    </StateProvider>
  );
};

export default App;
