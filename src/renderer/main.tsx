import { createRoot } from 'react-dom/client';
import { Strip } from './Strip';
import { Divider } from './Divider';
import { Meetings } from './Meetings';
import { Calendar } from './Calendar';
import { Focus } from './Focus';
import { Agents } from './Agents';
import './styles.css';

const view = new URLSearchParams(location.search).get('view');
const Root = view === 'divider' ? Divider : view === 'meetings' ? Meetings : view === 'calendar' ? Calendar : view === 'focus' ? Focus : view === 'agents' ? Agents : Strip;

document.body.dataset.view = view ?? 'strip';
createRoot(document.getElementById('root')!).render(<Root />);
