# Training the assistant with an LLM

The assistant must answer only from the WFX knowledge and say "not documented" otherwise. The safest way to "train" it is therefore to improve what it **finds** (retrieval) and how users' wording **maps** to the knowledge, not to let a model learn facts on its own. Atlas prepares everything for that; any LLM can be used (Claude, GPT, a local model).

## 1. Export the material

```
npm run kb:export-training                  # only Approved / Active knowledge
npm run kb:export-training -- --include-drafts
```

Writes `exports/llm-training/` (not committed; regenerate after the knowledge changes):

| File | What | Use |
| --- | --- | --- |
| `knowledge_corpus.jsonl` | every current entry with status and source | vector store / retrieval (RAG) |
| `qa_train.jsonl` | chat pairs: system / user question / assistant = the source's own text + source | fine-tuning or few-shot examples |
| `qa_validation.jsonl` | same, whole knowledge units kept out of training | measure on unseen answers |
| `eval_heldout.jsonl` | the 60 + 70 evaluation questions with expected source/status, incl. undocumented ones | before/after comparison — never train on it (any pair with the same question is dropped from training) |
| `question_prompts.jsonl` | one prompt per knowledge unit asking for more user-style questions | step 2 |

## 2. Let an LLM write more user questions (recommended first step)

1. Run each prompt of `question_prompts.jsonl` with your LLM. Each reply is one JSON line: `{"unit_id": "...", "questions": [{"text": "...", "category": "..."}]}`.
2. Put the replies in one file and import it:
   ```
   npm run kb:import-questions -- replies.jsonl --model "claude-opus-5-5"
   ```
   Checks: the unit must exist, plain questions only, 4–200 characters, duplicates skipped. Imported questions are **unreviewed proposals** (origin `llm`), stored in `knowledge/enrichment/review.json`.
3. Review them on **Knowledge › Question mapping**: approve, reject or edit. Rejected ones are never used.
4. Measure: `npm run kb:eval-paraphrase -- --test` (and `npm run kb:evaluate` for "not documented" answers). Keep the change only if the untouched half improves and hallucinations stay 0.

The LLM only writes **questions**. Answers stay the sources' own text, so a wrong LLM question can at worst point to the wrong unit — which the review and the evaluation catch.

## 3. Use the LLM to answer (the Claude chat in Atlas)

Atlas already has a Claude chat that searches the knowledge with tools and answers with sources. It is off until both are done:

- the API key in `D:\WFX Knowledge hub\ASN\.env` (`ANTHROPIC_API_KEY=…`, set it yourself; never paste keys into chat);
- the organisation's approval recorded in **Admin › AI provider**.

The better the question mapping (step 2), the better its searches.

## 4. Fine-tuning (only if retrieval is not enough)

`qa_train.jsonl` / `qa_validation.jsonl` are in the common chat format. Train first on pairs whose `metadata.questionReviewed` is true, keep the knowledge status in mind (`metadata.knowledgeStatus`), and compare with `eval_heldout.jsonl` before and after. A fine-tuned model goes stale when the knowledge changes; retrieval does not — re-export and re-train after every knowledge change if you fine-tune.
