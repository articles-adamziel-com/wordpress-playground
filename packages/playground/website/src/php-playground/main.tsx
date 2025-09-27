import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';

import { collectWindowErrors, logger } from '@php-wasm/logger';
import { Layout } from './components/Layout';
import { store } from './store';

collectWindowErrors(logger);

const root = createRoot(document.getElementById('root')!);
root.render(
	<Provider store={store}>
		<Layout />
	</Provider>
);
