declare module 'foliate-js/view.js' {
  export class View extends HTMLElement {
    book: any;
    renderer: any;
    lastLocation: any;
    history: any;
    isFixedLayout: boolean;
    open(book: any): Promise<void>;
    init(options: { lastLocation?: any; showTextStart?: boolean }): Promise<void>;
    resolveNavigation(target: any): any;
    goTo(target: any): Promise<void>;
    goToFraction(fraction: number): Promise<void>;
  }

  export function makeBook(file: File | Blob | string): Promise<any>;
}
