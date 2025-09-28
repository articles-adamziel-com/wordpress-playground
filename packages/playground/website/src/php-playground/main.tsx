/**
 * Follow-up work:
 *
 * * Files explorer
 *    * Don't re-render (and show the loading indicator) when not needed.
 *    * Improve visual feedback when loading files (don't replace filename with loader).
 *    * CSS papercuts, e.g. dark font on dark background for active hovered selected files.
 *    * Detect when a binary file is opened, show a special message "binary file. can't
 *      edit (download)"
 *    * Create and delete files and directories. "Refresh" button to refresh the directory
 *      tree – OR auto-refresh every second or five seconds.
 *    * Download file / directory action
 *    * ✅ Don't display "/", display just "home", "tmp", and "wordpress" directly
 *    * ✅ Refresh the files after collapsing and expanding the parent directory
 *    * ✅ Ensure it's scrollable with overflow: auto
 *    * ✅ Initialization UX – show the expanded path right away
 *    * ✅ Separate "focus" from "open" actions so that I can browse files
 *      without editing them
 * * Editor
 *    * ✅ Save changes when editing files other than code.php
 *    * ✅ Display breadcrumbs of the currently open file above the editor?
 * * Terminal
 *    * Implement cwd, cd
 *    * ✅ Communicate cwd in current prompt (like fish)
 *    * ✅ Disable terminal collapsing for now
 *    * ------- later: -------
 *    * Tab completion for paths
 *    * Implement basic `curl` and `curl -O` and `wget` to download remote files
 *    * Implement `git clone` and `git checkout`
 *    * Implement `unzip` (via PHP `ZipArchive`)
 *
 * ------- later: -------
 * * UX for sharing more involved setups, e.g. when I edit a WordPress plugin
 *   and not just the code snippet (Maybe connect GitHub and save diff in a
 *   repository or in a gist?)
 *    * "Git" tool to see diff against the initial state
 *    * "Save patch"
 *    * Maybe put that patch in the URL? Or, if too large, tell the user we need some place to store
 *      the data to keep it shareable?
 *    * Or add a "share" button that will tell them? But that changes the semantics vs the default
 *      way of "just copy the URL."
 *    * Or display a modal "Hey, this is the limit of the shareable URL. It won't be updated
 *      anymore until you connect Github or so".
 * * Tool palette (file browser, environment setup form with wp+php versions, Blueprint editor)
 * * Integrate with Playground.wordpress.net – bring over a tool
 *   palette (file browser, sites browser, Blueprints browser).
 * * A way to run composer install by default (simply via Blueprints?)
 *   Communicate what it's doing by displaying the output in the terminal
 * * Tabs for opening multiple files
 * * Find a way to put my workspace outside of WordPress and still serve it?
 *    * ln -s /workspace /wordpress/workspace?
 *    * Or just make it a WordPress plugin? /wordpress/wp-content/plugins/my-plugin?
 */

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
