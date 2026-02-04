export type MenuOptionItemType = {
  key: string;
  dataTest?: string;
  label?: string;
  customStyles?: object;
  iconRight?: string | null;
  icon?: string;
  onClick?: () => void;
  disabled?: boolean;
  contentFunction?: (element: HTMLElement) => { unmount: () => void };
};

export type MenuSeparatorItemType = {
  key: string;
  isSeparator?: boolean;
};

export type MenuTextItemType = {
  key: string;
  dataTest?: string;
  label?: string;
  customStyles?: object;
  iconRight?: string;
}
