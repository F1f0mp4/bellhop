import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTarget, isImportable, parseName, sanitize, validateMeta, type Meta } from '../src/media/naming.ts';

const dirs = { movies: 'Movies', shows: 'Shows', music: 'Music' };

const pick = (m: Meta) =>
  Object.fromEntries(Object.entries(m).filter(([k, v]) => v !== undefined && k !== 'ext'));

const cases: [string, string | undefined, Partial<Meta>][] = [
  ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', undefined, { type: 'movie', title: 'The Matrix', year: '1999' }],
  ['Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.mkv', undefined, { type: 'movie', title: 'Dune Part Two', year: '2024' }],
  ['Blade Runner 2049 (2017) [1080p].mp4', undefined, { type: 'movie', title: 'Blade Runner 2049', year: '2017' }],
  ['2001.A.Space.Odyssey.1968.REMASTERED.mkv', undefined, { type: 'movie', title: '2001 A Space Odyssey', year: '1968' }],
  ['[YTS] Parasite (2019) 720p.mp4', undefined, { type: 'movie', title: 'Parasite', year: '2019' }],
  ['Spirited_Away_2001.avi', undefined, { type: 'movie', title: 'Spirited Away', year: '2001' }],
  ['inception.mkv', undefined, { type: 'movie', title: 'Inception' }],
  ['Arrival 1080p.mkv', undefined, { type: 'movie', title: 'Arrival' }],
  ['movie.mkv', 'Dune (2021)', { type: 'movie', title: 'Dune', year: '2021' }],
  ['Severance.S02E05.1080p.ATVP.WEB-DL.mkv', undefined, { type: 'series', title: 'Severance', season: 2, episode: 5 }],
  ['The.Office.US.S03E01E02.720p.mkv', undefined, { type: 'series', title: 'The Office US', season: 3, episode: 1, episodeEnd: 2 }],
  ['Doctor.Who.2005.S01E01.Rose.mkv', undefined, { type: 'series', title: 'Doctor Who', year: '2005', season: 1, episode: 1 }],
  ['shogun s01e10 1080p.mkv', undefined, { type: 'series', title: 'Shogun', season: 1, episode: 10 }],
  ['Friends 1x02 The One with the Sonogram.avi', undefined, { type: 'series', title: 'Friends', season: 1, episode: 2 }],
  ['S01E03.mkv', 'Andor (2022)', { type: 'series', title: 'Andor', year: '2022', season: 1, episode: 3 }],
  ['Breaking Bad - S05E14 - Ozymandias.mkv', undefined, { type: 'series', title: 'Breaking Bad', season: 5, episode: 14 }],
  ['Fallout.S01E01.srt', undefined, { type: 'series', title: 'Fallout', season: 1, episode: 1 }],
  ['01 - Speak to Me.flac', 'Pink Floyd - The Dark Side of the Moon (1973)', { type: 'music', artist: 'Pink Floyd', album: 'The Dark Side of the Moon', year: '1973' }],
  ['Daft Punk - Get Lucky.mp3', undefined, { type: 'music', artist: 'Daft Punk', album: 'Unknown Album' }],
  ['03 Track.mp3', 'Random Access Memories', { type: 'music', artist: 'Unknown Artist', album: 'Random Access Memories' }],
];

for (const [file, folder, expected] of cases) {
  test(`parse ${file}${folder ? ` in ${folder}` : ''}`, () => {
    const got = pick(parseName(file, folder));
    for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, `${k} for ${file}: ${JSON.stringify(got)}`);
  });
}

test('movie target', () => {
  assert.equal(
    buildTarget({ type: 'movie', title: 'The Matrix', year: '1999' }, 'x.MKV', dirs),
    'Movies/The Matrix (1999)/The Matrix (1999).mkv',
  );
});

test('movie subtitle keeps language', () => {
  assert.equal(
    buildTarget({ type: 'movie', title: 'Dune', year: '2021' }, 'Dune.2021.en.forced.srt', dirs),
    'Movies/Dune (2021)/Dune (2021).en.forced.srt',
  );
});

test('series target', () => {
  assert.equal(
    buildTarget({ type: 'series', title: 'Severance', year: '2022', season: 2, episode: 5 }, 'a.mkv', dirs),
    'Shows/Severance (2022)/Season 02/Severance S02E05.mkv',
  );
  assert.equal(
    buildTarget({ type: 'series', title: 'The Office', season: 3, episode: 1, episodeEnd: 2 }, 'a.mkv', dirs),
    'Shows/The Office/Season 03/The Office S03E01-E02.mkv',
  );
});

test('music target', () => {
  assert.equal(
    buildTarget({ type: 'music', title: 'x', artist: 'AC/DC', album: 'Back in Black' }, '01 - Hells Bells.flac', dirs),
    'Music/ACDC/Back in Black/01 - Hells Bells.flac',
  );
});

test('sanitize strips separators and dots', () => {
  assert.equal(sanitize('Star Wars: A New Hope'), 'Star Wars - A New Hope');
  assert.equal(sanitize('../../etc'), 'etc');
  assert.equal(sanitize('..'), 'Unknown');
  assert.equal(sanitize('What If...?'), 'What If');
  assert.equal(sanitize('a\\b/c'), 'abc');
});

test('validateMeta', () => {
  assert.equal(validateMeta({ type: 'movie', title: 'X' }), null);
  assert.ok(validateMeta({ type: 'movie', title: ' ' }));
  assert.ok(validateMeta({ type: 'series', title: 'X', season: 1 }));
  assert.ok(validateMeta({ type: 'movie', title: 'X', year: '99' }));
});

test('samples and junk are skipped', () => {
  assert.equal(isImportable('movie-sample.mkv'), false);
  assert.equal(isImportable('Sample.mkv'), false);
  assert.equal(isImportable('info.nfo'), false);
  assert.equal(isImportable('The.Sampler.2020.mkv'), true);
});
