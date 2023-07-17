const { loadDictionary } = require('@scriptin/jmdict-simplified-loader');
const path = require('path');
const { program } = require('commander');
const https = require('https'); // or 'https' for https:// URLs
const fs = require('fs');
const fsPromises = require('fs').promises;
const tmp = require('tmp');
const child_process = require('child_process');
const sqlite3 = require('sqlite3').verbose();

async function main() {
  program
    .description(
      'Download jmdict-simplified and use it to populate an SQLite database.'
    )
    .requiredOption(
      '-i --input <type>',
      'The input JSON file for jmdict-simplified.',
      './downloads/jmdict-eng-3.5.0.json'
    )
    .option(
      '-d --download-url <type>',
      'The download URL for jmdict-simplified.',
      'https://github.com/scriptin/jmdict-simplified/releases/download/3.5.0%2B20230710121913/jmdict-eng-3.5.0+20230710121913.json.zip'
    )
    .requiredOption(
      '-o --output <type>',
      'The output SQLite database filepath.',
      './output/jmdict.sqlite3'
    );

  program.parse();

  let { input, downloadUrl, output } = program.opts();

  input = path.resolve(process.cwd(), input);
  output = path.resolve(process.cwd(), output);
  console.log(input);

  if (!fs.existsSync(input)) {
    if (!downloadUrl) {
      console.log(
        "--input needed downloading, but --download-url wasn't specified."
      );
      process.exit(1);
    }
    try {
      const downloadsDir = path.dirname(input);
      await fsPromises.mkdir(downloadsDir, { recursive: true });

      const tmpName = path.basename(tmp.tmpNameSync());
      const tmpFilepath = path.resolve(process.cwd(), downloadsDir, tmpName);

      await download(downloadUrl, tmpFilepath);

      // We don't know the contents of the zip, but trust blindly that it'll
      // emit a 'jmdict-eng-3.5.0.json' file.
      child_process.execSync(`unzip ${tmpFilepath} -d ${downloadsDir}`);

      await fsPromises.rm(tmpFilepath);
    } catch (error) {
      console.log('Failed to download jmdict-simplified.', error);
    }

    process.exit(1);
  }

  try {
    const outputDir = path.dirname(output);
    await fsPromises.mkdir(outputDir, { recursive: true });
    await populateDb(input, output);
  } catch (error) {
    console.log('Failed to generate DB.', error);
    process.exit(1);
  }

  process.exit(0);
}

/**
 * @param {string} input The URL to download from
 * @param {string} output The filepath to output to.
 * @returns {Promise<string>}
 */
function download(input, output) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(output);
    writeStream.on('error', (error) => reject(error));
    writeStream.on('finish', () => {
      writeStream.close();
      resolve(output);
    });

    /**
     * @param {string} url
     */
    const get = (url) => {
      https.get(url, (response) => {
        const {
          headers: { location },
          statusCode,
        } = response;

        if (response.statusCode === 302) {
          if (!location) {
            reject(new Error('Got 302 redirect but no Location header.'));
            response.resume();
            return;
          }

          return get(location);
        }

        if (statusCode !== 200) {
          reject(new Error(`Got status code ${statusCode}`));
          response.resume();
          return;
        }

        response.pipe(writeStream);
      });
    };

    get(input);
  });
}

/**
 *
 * @param {string} input the jmdict-simplified JSON file.
 * @param {string} dbPath the filepaht to the database.
 * @returns {Promise<void>}
 */
async function populateDb(input, dbPath) {
  /** @type {import('sqlite3').Database} */
  const db = await new Promise((resolve, reject) => {
    /** @type import('sqlite3').Database */
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        return reject(err);
      }

      return resolve(db);
    });
  });

  db.run(
    'CREATE TABLE IF NOT EXISTS words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, sense TEXT);',
    function onCompletion(error) {
      if (error) {
        console.log('SQLite error', error);
      }
    }
  );

  let i = 0;

  await /** @type {Promise<void>} */ (
    new Promise((resolve) => {
      const loader = loadDictionary('jmdict', input)
        .onMetadata(() => {})
        .onEntry((entry) => {
          i++;
          // console.log('entry', entry);
          // console.log('metadata entry', JSON.stringify(metadata));

          db.run(
            'INSERT OR REPLACE INTO words ("id", "kanji", "kana", "sense") VALUES ($id, $kanji, $kana, $sense)',
            {
              $id: entry.id,
              $kana: stringifyKana(entry.kana),
              $kanji: stringifyKanji(entry.kanji),
              $sense: stringifySense(entry.sense),
            },
            function onCompletion(error) {
              if (error) {
                console.log('SQLite error', error);
              }
            }
          );

          if (i > 1000) {
            process.exit(1);
          }
        })
        .onEnd(() => {
          console.log('Finished!');
          resolve();
        });

      // To handle parsing errors:
      // @ts-ignore
      loader.parser.on('error', (error) => {
        console.error(error);
      });
    })
  );

  db.close();
}

/**
 * @param {import('@scriptin/jmdict-simplified-types').JMdictKana[]} kana
 */
function stringifyKana(kana) {
  return JSON.stringify(
    kana.map((k) => {
      return {
        c: k.common ? 1 : 0,
        x: k.text,
        t: k.tags,
      };
    }),
    replacer
  );
}

/**
 * @param {import('@scriptin/jmdict-simplified-types').JMdictKanji[]} kanji
 */
function stringifyKanji(kanji) {
  return JSON.stringify(
    kanji.map((k) => {
      return {
        c: k.common ? 1 : 0,
        x: k.text,
        t: k.tags,
      };
    }),
    replacer
  );
}

/**
 * @param {import('@scriptin/jmdict-simplified-types').JMdictSense[]} senses
 */
function stringifySense(senses) {
  return JSON.stringify(
    senses.map((sense) => {
      const { gloss, partOfSpeech, ...rest } = sense;

      return {
        ...rest,
        pos: partOfSpeech,
        gloss: gloss.map((g) => g.text),
      };
    }),
    replacer
  );
}

/**
 * A replacer that omits any values that are empty arrays.
 * @param {string} key
 * @param {any} value
 * @returns {any}
 */
const replacer = (key, value) => {
  if (Array.isArray(value) && value.length === 0) {
    return undefined; // Omit the key from the output
  }
  return value;
};

main().catch(console.error);
