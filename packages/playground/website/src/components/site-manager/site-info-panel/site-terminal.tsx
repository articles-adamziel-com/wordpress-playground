import { TerminalWrapper } from '../../../../../website-extras/src/php-playground/components/terminal/Terminal';
import { usePlaygroundClient } from '../../../lib/use-playground-client';
import type { SiteInfo } from '../../../lib/state/redux/slice-sites';

interface SiteTerminalProps {
	site: SiteInfo;
	isVisible: boolean;
}

export function SiteTerminal({ site, isVisible }: SiteTerminalProps) {
	const playgroundClient = usePlaygroundClient(site.slug);

	return (
		<TerminalWrapper
			playgroundClient={playgroundClient || undefined}
			isCollapsed={!isVisible}
		/>
	);
}
