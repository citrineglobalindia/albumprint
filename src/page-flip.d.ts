// page-flip ships no type definitions: the small part of its API the album viewer uses.
declare module "page-flip" {
  export class PageFlip {
    constructor(el: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: HTMLElement[]): void;
    on(event: "flip" | "changeState" | "changeOrientation" | "init" | "update", cb: (e: { data: unknown }) => void): this;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    getCurrentPageIndex(): number;
    turnToPage(page: number): void;
    flip(page: number, corner?: "top" | "bottom"): void;
    getPageCount(): number;
    destroy(): void;
  }
}
