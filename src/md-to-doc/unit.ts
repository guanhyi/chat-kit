import {
  AlignmentType,
  convertInchesToTwip,
  IBaseCharacterStyleOptions,
  IBaseParagraphStyleOptions,
  IDocumentDefaultsOptions,
  ILevelsOptions,
  IPropertiesOptions,
  LevelFormat,
} from "docx";
/**
 * https://docx.js.org/#/usage/styling-with-js
 * docx.js 生成docx时的配置
 * 转换单位为docx的单位
 * 缩进以 TWIP 为单位
 * 段落间距，前后以 TWIP 为单位，行间距以行 240 分之一为单位
 * 字体大小以half-points为单位
 *
 *
 */
export const MdToDocUnit = {
  fontSize: {
    /**字体大小为docx的初号字号 */
    BIG_ONE: 42 * 2,
    /**字体大小为docx的小初字号 */
    SMALL_ONE: 36 * 2,

    /**字体大小为docx的二号字号 */
    BIG_TWO: 22 * 2,
    /**字体大小为docx的小二号字号 */
    SMALL_TWO: 18 * 2,

    /**字体大小为docx的三号字号 */
    BIG_THREE: 16 * 2,
    /**字体大小为docx的小三号字号 */
    SMALL_THREE: 15 * 2,

    /**字体大小为docx的四号字号 */
    BIG_FOUR: 14 * 2,
    /**字体大小为docx的小四号字号 */
    SMALL_FOUR: 12 * 2,

    /**字体大小为docx的五号字号 */
    BIG_FIVE: 10.5 * 2,
    /**字体大小为docx的小五号字号 */
    SMALL_FIVE: 9 * 2,
  },
};

const NUMBER_FONT = "Times New Roman";

type DEFAULT_TYPE = {
  readonly document?: IDocumentDefaultsOptions;
  readonly title?: IBaseParagraphStyleOptions;
  readonly heading1?: IBaseParagraphStyleOptions;
  readonly heading2?: IBaseParagraphStyleOptions;
  readonly heading3?: IBaseParagraphStyleOptions;
  readonly heading4?: IBaseParagraphStyleOptions;
  readonly heading5?: IBaseParagraphStyleOptions;
  readonly heading6?: IBaseParagraphStyleOptions;
  readonly strong?: IBaseParagraphStyleOptions;
  readonly listParagraph?: IBaseParagraphStyleOptions;
  readonly hyperlink?: IBaseCharacterStyleOptions;
  readonly footnoteReference?: IBaseCharacterStyleOptions;
  readonly footnoteText?: IBaseParagraphStyleOptions;
  readonly footnoteTextChar?: IBaseCharacterStyleOptions;
};

const DEFAULT_PARAGRAPH_STYLE: DEFAULT_TYPE = {
  heading1: {
    run: {
      size: MdToDocUnit.fontSize.BIG_TWO,
      // bold: true,
      font: {
        eastAsia: "黑体",
        ascii: NUMBER_FONT,
      },
      color: "#000000",
    },
    paragraph: {
      indent: { start: convertInchesToTwip(0) },
      spacing: {
        // after: 120,
      },
    },
  },
  heading2: {
    run: {
      size: MdToDocUnit.fontSize.BIG_THREE,
      bold: true,
      font: {
        eastAsia: "楷体GB2312",
        ascii: NUMBER_FONT,
      },
      // italics: true,
    },
    paragraph: {
      indent: { start: convertInchesToTwip(0) },
      spacing: {
        // before: 240,
        // after: 120,
      },
    },
  },
  heading3: {
    run: {
      size: MdToDocUnit.fontSize.BIG_THREE,
      bold: true,
      font: {
        eastAsia: "仿宋GB2312",
        ascii: NUMBER_FONT,
      },
      // italics: true,
    },
    paragraph: {
      indent: { start: convertInchesToTwip(0) },
      spacing: {
        // before: 240,
        // after: 120,
      },
    },
  },
  heading4: {
    run: {
      size: 32,
      bold: true,
      color: "#000000",
      font: {
        eastAsia: "仿宋GB2312",
        ascii: NUMBER_FONT,
      },
      // italics: true,
    },
    paragraph: {
      indent: { start: convertInchesToTwip(0) },
      spacing: {
        // before: 240,
        // after: 120,
      },
    },
  },
  listParagraph: {
    run: {
      color: "#000000",
      font: {
        eastAsia: "仿宋GB2312",
        ascii: NUMBER_FONT,
      },
      // emphasisMark: {},
    },

    paragraph: {
      indent: { start: convertInchesToTwip(0) },
      spacing: {
        line: 1.5 * 240,
        before: 0,
        after: 0,
      },
    },
  },
  document: {
    run: {
      size: MdToDocUnit.fontSize.BIG_THREE,
      font: {
        eastAsia: "仿宋GB2312",
        ascii: NUMBER_FONT,
      },
      // italic: false,
    },
    paragraph: {
      indent: { start: convertInchesToTwip(0) },
      spacing: {
        line: 1.5 * 240,
        before: 240,
        after: 120,
      },
    },
  },
};

/**
 * 政府用word格式
 * 文章题目用二号小标宋简体，副标题、标题下名字和日期用三号楷体GB2312，正文用三号仿宋GB2312。
 *（二）一级标题用黑体，二级用楷体GB2312加粗，三级用仿宋GB2312加粗。
 *（三）排版上端留空3cm，左、右、下分别留空2.7cm。
 *（四）段落一般用固定值30。
 */
export const GMDocumentStandard: IPropertiesOptions["styles"] = {
  default: DEFAULT_PARAGRAPH_STYLE,
  paragraphStyles: [
    {
      id: "Normal",
      name: "Normal",
      run: {
        size: MdToDocUnit.fontSize.BIG_THREE,
        font: {
          eastAsia: "仿宋GB2312",
          ascii: NUMBER_FONT,
        },
        // italic: false,
      },
      paragraph: {
        indent: {
          firstLine: `${MdToDocUnit.fontSize.BIG_THREE}pt`,
        },
        spacing: {
          line: 1.5 * 240,
          before: 240,
          after: 120,
        },
      },
    },
    {
      id: "Heading1",
      name: "Heading 1",
      ...DEFAULT_PARAGRAPH_STYLE.heading1,
    },
    {
      id: "Heading2",
      name: "Heading 2",
      ...DEFAULT_PARAGRAPH_STYLE.heading2,
    },
    {
      id: "Heading3",
      name: "Heading 3",
      ...DEFAULT_PARAGRAPH_STYLE.heading3,
    },
    {
      id: "Heading4",
      name: "Heading 4",
      ...DEFAULT_PARAGRAPH_STYLE.heading4,
    },
    {
      id: "TableParagraph",
      name: "TableParagraph",
      run: {
        size: MdToDocUnit.fontSize.BIG_THREE,
        font: {
          eastAsia: "仿宋GB2312",
        },
      },
      paragraph: {
        indent: { start: convertInchesToTwip(0) },
      },
    },
  ],
};

const INDENT = 0.5;
export const CHINESE_NUMBERINGS: ILevelsOptions[] = [
  {
    level: 0,
    format: LevelFormat.CHINESE_COUNTING,
    text: "%1.",
    alignment: AlignmentType.START,
  },
  {
    level: 1,
    format: LevelFormat.CHINESE_COUNTING,
    text: "%2.",
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { start: convertInchesToTwip(INDENT * 1) },
      },
    },
  },
  {
    level: 2,
    format: LevelFormat.CHINESE_COUNTING,
    text: "%3.",
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { start: convertInchesToTwip(INDENT * 2) },
      },
    },
  },
  {
    level: 3,
    format: LevelFormat.CHINESE_COUNTING,
    text: "%4.",
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { start: convertInchesToTwip(INDENT * 3) },
      },
    },
  },
  {
    level: 4,
    format: LevelFormat.CHINESE_COUNTING,
    text: "%5.",
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { start: convertInchesToTwip(INDENT * 4) },
      },
    },
  },
  {
    level: 5,
    format: LevelFormat.CHINESE_COUNTING,
    text: "%6.",
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { start: convertInchesToTwip(INDENT * 5) },
      },
    },
  },
];
