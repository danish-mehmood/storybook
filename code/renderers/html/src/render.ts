/* eslint-disable no-param-reassign */
// @ts-ignore
import global from 'global';

import { dedent } from 'ts-dedent';
import { simulatePageLoad, simulateDOMContentLoaded } from '@storybook/preview-web';
import type { RenderContext } from '@storybook/store';
import type { HtmlFramework } from './types';

const { Node } = global;

export function renderToDOM(
  { storyFn, kind, name, showMain, showError, forceRemount }: RenderContext<HtmlFramework>,
  domElement: Element
) {
  const element = storyFn();
  showMain();
  if (typeof element === 'string') {
    domElement.innerHTML = element;
    simulatePageLoad(domElement);
  } else if (element instanceof Node) {
    if (domElement.firstChild === element && forceRemount === false) {
      return;
    }

    domElement.innerHTML = '';
    domElement.appendChild(element);
    simulateDOMContentLoaded();
  } else {
    showError({
      title: `Expecting an HTML snippet or DOM node from the story: "${name}" of "${kind}".`,
      description: dedent`
        Did you forget to return the HTML snippet from the story?
        Use "() => <your snippet or node>" or when defining the story.
      `,
    });
  }
}
