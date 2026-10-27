import type {CSSProperties} from 'react';
import type {WorkStatus} from '../src/contracts';

export type IconName = 'arrow-left' | 'arrow-right' | 'arrow-up' | 'arrow-up-right' | 'check' | 'check-circle' | 'chevron-down' | 'chevron-right' | 'circle' | 'clock' | 'close' | 'code' | 'cpu' | 'copy' | 'file' | 'folder' | 'graph' | 'info' | 'layers' | 'list' | 'pause' | 'play' | 'plus' | 'project' | 'refresh' | 'search' | 'settings' | 'shield' | 'stop' | 'team' | 'undo' | 'terminal' | 'warning' | 'workflow' | 'x-circle';
const paths: Record<IconName, string[]> = {
  'arrow-left': ['m10 4-6 6 6 6', 'M4 10h13'],
  'arrow-right': ['m10 4 6 6-6 6', 'M3 10h13'],
  'arrow-up': ['m4 10 6-6 6 6', 'M10 4v13'],
  'arrow-up-right': ['M5 15 15 5', 'M5 5h10v10'],
  check: ['m4 10 4 4 8-8'],
  'check-circle': ['M17 10a7 7 0 1 1-3-5.7', 'm6 9 3 3 8-8'],
  'chevron-down': ['m5 7 5 5 5-5'],
  'chevron-right': ['m7 5 5 5-5 5'],
  circle: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'],
  clock: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'M10 6v4l3 2'],
  close: ['m5 5 10 10', 'm15 5-10 10'],
  code: ['m6 6-4 4 4 4', 'm14 6 4 4-4 4', 'm12 3-4 14'],
  cpu: ['M5 5h10v10H5z', 'M8 8h4v4H8z', 'M7 2v3m6-3v3M7 15v3m6-3v3M2 7h3m-3 6h3m10-6h3m-3 6h3'],
  copy: ['M7 7h10v10H7z', 'M3 13V3h10'],
  file: ['M5 2h6l4 4v12H5z', 'M11 2v5h4', 'M8 11h4', 'M8 14h4'],
  folder: ['M2 5h6l2 2h8v10H2z'],
  graph: ['M4 5h5v4H4z', 'M12 12h5v4h-5z', 'M6 9v5h6', 'M9 7h5v5'],
  info: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'M10 9v5', 'M10 6v.1'],
  layers: ['m10 2 8 5-8 5-8-5z', 'm2 11 8 5 8-5', 'm2 15 8 4 8-4'],
  list: ['M7 5h10', 'M7 10h10', 'M7 15h10', 'M3 5h.1', 'M3 10h.1', 'M3 15h.1'],
  pause: ['M6 4v12', 'M14 4v12'],
  play: ['m6 3 11 7-11 7z'],
  plus: ['M10 3v14', 'M3 10h14'],
  project: ['M3 3h14v14H3z', 'M3 8h14', 'M8 8v9'],
  refresh: ['M16 7a6.5 6.5 0 0 0-11-3L2 7', 'M2 2v5h5', 'M4 13a6.5 6.5 0 0 0 11 3l3-3', 'M13 13h5v5'],
  search: ['M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0', 'm12 12 6 6'],
  settings: ['M8 2h4l1 3 3 1 2 3-2 3-3 1-1 4H8l-1-4-3-1-2-3 2-3 3-1z', 'M13 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  shield: ['m10 2 7 3v5c0 4-7 8-7 8s-7-4-7-8V5z', 'm6 10 3 3 5-6'],
  stop: ['M5 5h10v10H5z'],
  team: ['M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M4 18v-3a6 6 0 0 1 12 0v3', 'M16 3a3 3 0 0 1 0 6', 'M17 12a5 5 0 0 1 2 4'],
  undo: ['m7 4-4 4 4 4', 'M3 8h9a5 5 0 0 1 0 10h-2'],
  terminal: ['M2 3h16v14H2z', 'm5 7 3 3-3 3', 'M11 13h4'],
  warning: ['m10 2 9 16H1z', 'M10 7v5', 'M10 15v.1'],
  workflow: ['M3 2h5v5H3z', 'M12 13h5v5h-5z', 'M5.5 7v7h6.5', 'M8 4.5h6.5V13'],
  'x-circle': ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'm7 7 6 6', 'm13 7-6 6'],
};
export function Icon({name, size = 16, className = '', style}: {name: IconName; size?: number; className?: string; style?: CSSProperties}) {
  return <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}>{paths[name].map((path, index) => <path key={index} d={path}/>)}</svg>;
}
const statusIcons: Record<WorkStatus, IconName> = {queued:'circle', running:'refresh', waiting:'clock', review:'info', paused:'pause', skipped:'circle', completed:'check-circle', failed:'x-circle', cancelled:'stop', interrupted:'warning'};
export function StateIcon({status}: {status?: WorkStatus}) { return <Icon name={status ? statusIcons[status] : 'circle'} className={`state-icon state-${status ?? 'pending'} ${status === 'running' ? 'is-running' : ''}`}/>; }
export function Brand({compact = false}: {compact?: boolean}) { return <span className="ui-brand"><img src="/brand/gwi-mark.svg" width="28" height="28" alt=""/>{!compact && <span>GWI</span>}</span>; }
