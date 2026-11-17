# Google Autocomplete Scraper + YouTube, Amazon, DuckDuckGo

Give this Google autocomplete scraper seed keywords and get back what people actually type: the **autocomplete suggestions from
Google, YouTube, Amazon and DuckDuckGo**, all in one run and one table. One row per suggestion, with
the engine and its rank.

- **Four engines in one run:** compare search intent (Google), video intent (YouTube) and buying
  intent (Amazon) for the same keyword.
- **Expansion modes:** A-Z, questions and prepositions turn one seed into hundreds of long-tail keywords.
- **Fast:** plain HTTP, no browser. In our tests, 132 requests finished in about 7 seconds.
- **No duplicates:** each suggestion is saved and charged once per engine.

Open source (MIT). Written in Node.js on the Apify SDK; it runs on your own machine without an Apify account.

## Run it locally

Needs Node.js 20 or later.

```
git clone https://github.com/sebdata-tools/search-autocomplete.git
cd search-autocomplete
npm install
node test/run_local.mjs @input.json
```

`input.json` is a file you write; the fields are under "Input example" below. `run_local.mjs` runs
`src/main.js` with local storage, prints a summary and the first rows, and leaves all rows in
`storage/items.json` (one file per row is in `storage/datasets/default/`). Each run wipes `storage/` first.

Where the sections below mention a price or what is charged, that applies to the hosted version only:
run locally, nothing is charged.

## Input example

```json
{
    "keywords": ["running shoes", "air fryer"],
    "engines": ["google", "youtube", "amazon", "duckduckgo"],
    "language": "en",
    "country": "US",
    "expandAlphabet": true,
    "expandQuestions": false
}
```

| Field | What it does | Default |
|---|---|---|
| `keywords` | Seed keywords, up to 1,000. Required. | |
| `engines` | Any of `google`, `youtube`, `duckduckgo`, `amazon`. | all four |
| `language` | Language code: `en`, `de`, `fr`, `es`, `ja`... | `en` |
| `country` | Two-letter country code: `US`, `GB`, `DE`, `JP`... | `US` |
| `expandAlphabet` | Also ask `keyword a` ... `keyword z`. | `false` |
| `expandQuestions` | Also ask `how keyword`, `what keyword`, `why keyword`... (12 English question words). | `false` |
| `expandPrepositions` | Also ask `keyword for`, `keyword with`, `keyword vs`... (9 English words). | `false` |
| `deduplicate` | Save each suggestion once per engine. | `true` |
| `proxyConfiguration` | Optional proxy. Normally not needed. | none |

## Output example

```json
{
    "seed": "air fryer",
    "engine": "amazon",
    "query": "air fryer",
    "suggestion": "air fryer liners disposable",
    "position": 2,
    "language": "en",
    "country": "US",
    "scrapedAt": "2026-11-13T23:31:12.004Z"
}
```

Export the dataset as JSON, CSV or Excel, or read it through the Apify API.

## How many results to expect

Each engine returns up to about 10 suggestions per request. Without expansion that is up to about
40 suggestions per keyword across the four engines. With A-Z expansion, one keyword is asked 27
times per engine: in our test a single German keyword returned 457 unique suggestions. Niche
keywords return fewer; a keyword nobody searches returns none, and the run still succeeds.

## Good to know

- **Amazon by country:** suggestions come from the Amazon site of the chosen country (US, CA, MX,
  BR, GB, DE, FR, IT, ES, NL, IN, JP, AU). For any other country the Actor uses amazon.com and says
  so in the log.
- **Question and preposition expansion use English words.** For other languages use A-Z expansion,
  or put your own variants in `keywords`.
- **Position** is the rank inside the answer for the `query` that was sent, not a search volume.
  Autocomplete gives no volumes.
- **A request that fails** after several retries is skipped and reported in the log; the rest of the
  run carries on. The run's key-value store has a `SUMMARY` record with counts per engine.
- **Spending limit:** if you set a maximum charge for the run, the Actor stops when it is reached
  and keeps what it has saved.

## Typical uses

Keyword research for SEO and content, YouTube video ideas, Amazon listing keywords, finding the
questions people ask about a product, feeding keyword ideas to an LLM or agent.

## Tests

`src/lib.js` holds the pure logic (input checks, URL building, parsing); `src/main.js` holds the network
and storage code. The unit tests in `test/lib.test.js` run `lib.js` against saved answers of the live
sources. Those files are copies of third-party pages and API answers and are **not included in this
repository**, so `npm test` says so and skips. To run them, save your own captures under `test/fixtures/`
with the file names the test reads. The live check is `node test/run_local.mjs @input.json`.

## Hosted version

To run it in the cloud, on a schedule or through an API, without installing anything: [Google Autocomplete Scraper + YouTube, Amazon, DuckDuckGo on Apify](https://apify.com/sebdata/search-autocomplete) (paid per result).

## Who made this

This tool and its code were written by an AI agent (Anthropic's Claude), under a human account owner. Problems and wrong results: open an issue. MIT licence, no warranty.
