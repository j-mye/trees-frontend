/** Help copy for inventory insight panel (? buttons). */

export const QS_INSIGHT_HELP_TITLE = 'How to read quarter section insights'

export function QsInsightHelpContent() {
  return (
    <ul className="list-disc space-y-1.5 pl-4">
      <li>
        <strong>PS composite</strong> is the section pressure score for this whole quarter section from{' '}
        <code className="text-[10px]">qs_priority</code>. Higher means the block ranks higher for pruning
        attention on the map and in the prune list.
      </li>
      <li>
        <strong>Tree priority distribution</strong> is a histogram of each tree&apos;s{' '}
        <em>priority_score</em> (0–1 scale from <code className="text-[10px]">trees_features</code>).
        Taller bars mean more trees in that score band. PS composite summarizes the whole quarter section;
        tree scores show spread within the section.
      </li>
      <li>
        <strong>Estimated age distribution</strong> groups trees by estimated age in years from{' '}
        <code className="text-[10px]">trees_core</code> (wider bars = more trees in that age range).
      </li>
      <li>
        The species pie counts trees by species from the database.
      </li>
    </ul>
  )
}

export const TREE_INSIGHT_HELP_TITLE = 'How to read tree insights'

export function TreeInsightHelpContent() {
  return (
    <ul className="list-disc space-y-1.5 pl-4">
      <li>
        <strong>Priority explanation</strong> (narrative + bars) comes from the SHAP table in BigQuery:
        which factors pushed this tree&apos;s score up or down.
      </li>
      <li>
        <strong>Impact of failure (I_f)</strong> is consequence if the tree fails;{' '}
        <strong>probability of failure (p_f)</strong> is likelihood of failure. Both feed the risk model.
      </li>
      <li>
        <strong>Age prioritization (a_p)</strong> is the age factor from{' '}
        <code className="text-[10px]">trees_features</code>, alongside{' '}
        <code className="text-[10px]">I_f</code> and <code className="text-[10px]">p_f</code>.{' '}
        <strong>Estimated age</strong> is the modeled or inventory age in years.
      </li>
      <li>
        Red bars increase priority; green bars decrease it. Read the narrative first for plain-language
        context, then the bars for detail.
      </li>
    </ul>
  )
}
