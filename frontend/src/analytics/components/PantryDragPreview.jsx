import { memo } from 'react'
import { dimensionPillClass, measurePillClass } from '../pantryChipStyles.js'

/**
 * @param {object} props
 * @param {{ id: string, name: string, type: 'dimension' | 'measure' }} props.variable
 */
function PantryDragPreviewInner({ variable }) {
  const className = variable.type === 'dimension' ? dimensionPillClass : measurePillClass
  return (
    <div role="presentation" className={`${className} cursor-grabbing`}>
      <span
        className={`material-symbols-outlined text-sm ${variable.type === 'dimension' ? 'text-on-primary-container' : ''}`}
      >
        drag_indicator
      </span>
      {variable.type === 'dimension' ? (
        <span className="text-on-primary-container">{variable.name}</span>
      ) : (
        variable.name
      )}
    </div>
  )
}

export const PantryDragPreview = memo(PantryDragPreviewInner)
