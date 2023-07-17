# jmdict-sqlite

A crude script to download a release of `jmdict-simplified` and build an SQLite database from it. The database comes to 50 MB at the moment, but a lot more space could be saved by using less human-readable names in the JSON objects.

## Schema

Some modifications from `jmdict-simplified`:

* commonly-occurring values like `[]` and `["*"]` are simply omitted and assumed as defaults
* we throw away some uninteresting/constant data from the glosses.
* some keys are reduced to less human-readable names to reduce the character count

## Installation

```sh
yarn install
```

## Running

This assumes that the given `.json.zip` release will unzip to a single file named `jmdict-eng-3.5.0.json`.

```sh
node src/index.js start -i ./downloads/jmdict-eng-3.5.0.json -o ./output/jmdict.sqlite3 -d https://github.com/scriptin/jmdict-simplified/releases/download/3.5.0%2B20230710121913/jmdict-eng-3.5.0+20230710121913.json.zip
```

## Re-running

In theory, the script if re-run should be able to update existing entries, but it takes just as long to just build from scratch so you might as well do the latter as I don't totally trust the update process.
