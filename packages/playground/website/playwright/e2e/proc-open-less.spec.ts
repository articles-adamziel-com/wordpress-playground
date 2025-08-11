import { test, expect } from '../playground-fixtures.ts';

// Preface to Pygmalion is a longer chunk of text that won't fit into a pipe buffer
// and will require multiple read/write cycles to complete. This is perfect for
// testing whether these chunks are appended to the output one after another
// (as opposed to writing over the previous chunk).
const pygmalion = `PREFACE TO PYGMALION.

A Professor of Phonetics.

As will be seen later on, Pygmalion needs, not a preface, but a sequel,
which I have supplied in its due place. The English have no respect for
their language, and will not teach their children to speak it. They
spell it so abominably that no man can teach himself what it sounds
like. It is impossible for an Englishman to open his mouth without
making some other Englishman hate or despise him. German and Spanish
are accessible to foreigners: English is not accessible even to
Englishmen. The reformer England needs today is an energetic phonetic
enthusiast: that is why I have made such a one the hero of a popular
play. There have been heroes of that kind crying in the wilderness for
many years past. When I became interested in the subject towards the
end of the eighteen-seventies, Melville Bell was dead; but Alexander J.
Ellis was still a living patriarch, with an impressive head always
covered by a velvet skull cap, for which he would apologize to public
meetings in a very courtly manner. He and Tito Pagliardini, another
phonetic veteran, were men whom it was impossible to dislike. Henry
Sweet, then a young man, lacked their sweetness of character: he was
about as conciliatory to conventional mortals as Ibsen or Samuel
Butler. His great ability as a phonetician (he was, I think, the best
of them all at his job) would have entitled him to high official
recognition, and perhaps enabled him to popularize his subject, but for
his Satanic contempt for all academic dignitaries and persons in
general who thought more of Greek than of phonetics. Once, in the days
when the Imperial Institute rose in South Kensington, and Joseph
Chamberlain was booming the Empire, I induced the editor of a leading
monthly review to commission an article from Sweet on the imperial
importance of his subject. When it arrived, it contained nothing but a
savagely derisive attack on a professor of language and literature
whose chair Sweet regarded as proper to a phonetic expert only. The
article, being libelous, had to be returned as impossible; and I had to
renounce my dream of dragging its author into the limelight. When I met
him afterwards, for the first time for many years, I found to my
astonishment that he, who had been a quite tolerably presentable young
man, had actually managed by sheer scorn to alter his personal
appearance until he had become a sort of walking repudiation of Oxford
and all its traditions. It must have been largely in his own despite
that he was squeezed into something called a Readership of phonetics
there. The future of phonetics rests probably with his pupils, who all
swore by him; but nothing could bring the man himself into any sort of
compliance with the university, to which he nevertheless clung by
divine right in an intensely Oxonian way. I daresay his papers, if he
has left any, include some satires that may be published without too
destructive results fifty years hence. He was, I believe, not in the
least an ill-natured man: very much the opposite, I should say; but he
would not suffer fools gladly.`;

test('proc_open "less" echoes stdin to stdout in the browser', async ({
	page,
	website,
}) => {
	await website.goto('/');
	const output = await page.evaluate(async (text) => {
		const playground: any = (window as any).playground;
		const code = `<?php
$fd = fopen("php://temp", "r+");
fputs($fd, ${JSON.stringify(text)});
rewind($fd);
$descriptorspec = array(
        0 => $fd,
        1 => fopen('php://stdout', 'wb'),
        2 => fopen('php://stderr', 'wb')
);
$fp = proc_open('less', $descriptorspec, $pipes);
proc_close($fp);
?>`;
		const result = await playground.run({ code });
		return result.text;
	}, pygmalion);
	expect(output).toBe(pygmalion);
});
