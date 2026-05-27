CREATE TABLE IF NOT EXISTS marketing.mentions (
  mention_id    text PRIMARY KEY,
  brand         text NOT NULL,
  source        text NOT NULL,
  url           text NOT NULL,
  title         text,
  text          text,
  author        text,
  ts            timestamptz,
  sentiment     text,
  is_prospect   boolean DEFAULT false,
  summary       text,
  captured_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mentions_brand_chk CHECK (
    brand IN ('ticket', 'neat', 'auric', 'alivelabs')
  ),
  CONSTRAINT mentions_sentiment_chk CHECK (
    sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_mentions_brand_captured ON marketing.mentions (brand, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_is_prospect     ON marketing.mentions (is_prospect) WHERE is_prospect = true;
CREATE INDEX IF NOT EXISTS idx_mentions_sentiment       ON marketing.mentions (sentiment);

COMMENT ON TABLE marketing.mentions IS
  'Stream 5 monitoring (item 19) — web mentions captured via Exa, classified by Claude.';
