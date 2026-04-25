import { workModeRegistry } from '../../../main/workmode/registry';

export function register(): void {
  workModeRegistry.register({
    id: 'graph',
    viewType: 'graph',
    icon: '🕸',
    label: 'Graph',
    order: 7,
  });
}
