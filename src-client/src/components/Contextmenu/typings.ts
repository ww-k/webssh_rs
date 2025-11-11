export interface IContextmenuDataItem {
    type?: string;
    label?: string;
    disabled?: boolean;
    iconCls?: string;
    tooltip?: string;
    subMenuId?: number;
    labelStyle?: React.CSSProperties;
    click?: React.MouseEventHandler<HTMLLIElement>;
    iconRender?: () => React.ReactNode;
    children?: IContextmenuDataItem[];
}
