import { useMemo, useState } from 'react'
import { useArena } from '../state/ArenaProvider'
import { Icon } from '../ui/Icons'
import { Chip, Panel, StatusChip, Tabs } from '../ui/primitives'

type Filter = 'all' | '1' | '2' | '3' | '4'

export default function Questions() {
  const { questions, currentLevel } = useArena()
  const [filter, setFilter] = useState<Filter>('all')
  const visible = useMemo(() => filter === 'all' ? questions : questions.filter((question) => question.level === Number(filter)), [questions, filter])

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Challenges / questions</div>
          <h1>Task briefs</h1>
          <p>Admin configured prompts for each level. Sample prompts are clearly marked and are not real competition questions.</p>
        </div>
        <Chip tone="warn">Sample data</Chip>
      </header>

      <Panel eyebrow="Briefs" title="Question catalogue"
        action={<Tabs<Filter> tabs={[
          { id: 'all', label: 'All' }, { id: '1', label: 'L1' }, { id: '2', label: 'L2' }, { id: '3', label: 'L3' }, { id: '4', label: 'L4' },
        ]} active={filter} onChange={setFilter} />}>
        <div className="ar-sample-note"><Icon name="warning" size={13} /> Illustrative questions only. Unreleased questions and answers are never shown before their level unlocks.</div>
        <div className="ar-questions-grid">
          {visible.map((question) => {
            const locked = question.level > currentLevel
            const reveal = question.status === 'answered' && !locked
            return (
              <article key={question.id} className={`ar-question-card ${locked ? 'is-locked' : ''}`}>
                <div className="ar-question-card__head">
                  <span className="ar-mono">{question.id} · Level {question.level}</span>
                  <StatusChip status={locked ? 'locked' : question.status} />
                </div>
                <strong>{question.title}</strong>
                {locked ? (
                  <div className="ar-question-locked"><Icon name="lock" size={15} /><span>Released when Level {question.level} unlocks.</span></div>
                ) : (
                  <>
                    <p>{question.prompt}</p>
                    <div className="ar-question-requirement"><Icon name="target" size={13} /><span>{question.requirement}</span></div>
                    <div className="ar-question-card__foot"><span><Icon name="file" size={12} />{question.targetHint}</span><strong>{question.points} pts</strong></div>
                    {reveal && question.answer && <div className="ar-answer"><strong>Released answer</strong><p>{question.answer}</p></div>}
                    {!reveal && <div className="ar-answer-pending">Feedback and answer stay hidden until release.</div>}
                  </>
                )}
              </article>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
