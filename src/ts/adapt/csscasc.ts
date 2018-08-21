/**
 * Copyright 2013 Google, Inc.
 * Copyright 2015 Trim-marks Inc.
 *
 * Vivliostyle.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Vivliostyle.js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Vivliostyle.js.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @fileoverview CSS Cascade.
 */
import * as logging from '../vivliostyle/logging';
import * as plugin from '../vivliostyle/plugin';
import {Matcher} from '../vivliostyle/selectors';

import * as css from './css';
import * as cssparse from './cssparse';
import * as cssprop from './cssprop';
import * as cssvalid from './cssvalid';
import * as expr from './expr';
import * as task from './task';
import * as taskutil from './taskutil';
import {ExprContentListener} from './vtree';
import {NodeContext} from './vtree';

export const inheritedProps = {
  'azimuth': true,
  'border-collapse': true,
  'border-spacing': true,
  'caption-side': true,
  'clip-rule': true,
  'color': true,
  'color-interpolation': true,
  'color-rendering': true,
  'cursor': true,
  'direction': true,
  'elevation': true,
  'empty-cells': true,
  'fill': true,
  'fill-opacity': true,
  'fill-rule': true,
  'font-kerning': true,
  'font-size': true,
  'font-size-adjust': true,
  'font-family': true,
  'font-feature-settings': true,
  'font-style': true,
  'font-stretch': true,
  'font-variant': true,
  'font-weight': true,
  'glyph-orientation-vertical': true,
  'hyphens': true,
  'hyphenate-character': true,
  'hyphenate-limit-chars': true,
  'hyphenate-limit-last': true,
  'image-rendering': true,
  'image-resolution': true,
  'letter-spacing': true,
  'line-break': true,
  'line-height': true,
  'list-style-image': true,
  'list-style-position': true,
  'list-style-type': true,
  'marker': true,
  'marker-end': true,
  'marker-mid': true,
  'marker-start': true,
  'orphans': true,
  'overflow-wrap': true,
  'paint-order': true,
  'pointer-events': true,
  'pitch-range': true,
  'quotes': true,
  'richness': true,
  'ruby-align': true,
  'ruby-position': true,
  'speak-header': true,
  'speak-numeral': true,
  'speak-punctuation': true,
  'speech-rate': true,
  'shape-rendering': true,
  'stress': true,
  'stroke': true,
  'stroke-dasharray': true,
  'stroke-dashoffset': true,
  'stroke-linecap': true,
  'stroke-linejoin': true,
  'stroke-miterlimit': true,
  'stroke-opacity': true,
  'stroke-width': true,
  'tab-size': true,
  'text-align': true,
  'text-align-last': true,
  'text-anchor': true,
  'text-decoration-skip': true,
  'text-emphasis-color': true,
  'text-emphasis-position': true,
  'text-emphasis-style': true,
  'text-combine-upright': true,
  'text-indent': true,
  'text-justify': true,
  'text-rendering': true,
  'text-size-adjust': true,
  'text-transform': true,
  'text-underline-position': true,
  'visibility': true,
  'voice-family': true,
  'volume': true,
  'white-space': true,
  'widows': true,
  'word-break': true,
  'word-spacing': true,
  'word-wrap': true,
  'writing-mode': true
};

export const polyfilledInheritedProps = [
  'box-decoration-break',
  // TODO: box-decoration-block should not be inherited.
  // https://github.com/vivliostyle/vivliostyle.js/issues/259
  'image-resolution', 'orphans', 'widows'
];

export const getPolyfilledInheritedProps = (): string[] => {
  const hooks: plugin.PolyfilledInheritedPropsHook[] =
      plugin.getHooksForName(plugin.HOOKS.POLYFILLED_INHERITED_PROPS);
  return hooks.reduce(
      (props, f) => props.concat(f()), [].concat(polyfilledInheritedProps));
};

export const supportedNamespaces = {
  'http://www.idpf.org/2007/ops': true,
  'http://www.w3.org/1999/xhtml': true,
  'http://www.w3.org/2000/svg': true
};

export const coupledPatterns = [
  'margin-%', 'padding-%', 'border-%-width', 'border-%-style', 'border-%-color',
  '%'
];

export const coupledExtentPatterns = ['max-%', 'min-%', '%'];

export const geomNames: {[key: string]: boolean} = (() => {
  const sides = ['left', 'right', 'top', 'bottom'];
  const names = {
    'width': true,
    'height': true,
    'max-width': true,
    'max-height': true,
    'min-width': true,
    'min-height': true
  };
  for (let i = 0; i < coupledPatterns.length; i++) {
    for (let k = 0; k < sides.length; k++) {
      const name = coupledPatterns[i].replace('%', sides[k]);
      names[name] = true;
    }
  }
  return names;
})();

export const buildCouplingMap =
    (sideMap: {[key: string]: string}, extentMap: {[key: string]: string}):
        {[key: string]: string} => {
          const map = {};
          for (const pattern of coupledPatterns) {
            for (const side in sideMap) {
              const name1 = pattern.replace('%', side);
              const name2 = pattern.replace('%', sideMap[side]);
              map[name1] = name2;
              map[name2] = name1;
            }
          }
          for (const extentPattern of coupledExtentPatterns) {
            for (const extent in extentMap) {
              const name1 = extentPattern.replace('%', extent);
              const name2 = extentPattern.replace('%', extentMap[extent]);
              map[name1] = name2;
              map[name2] = name1;
            }
          }
          return map;
        };

export const couplingMapVert = buildCouplingMap(
    {
      'block-start': 'right',
      'block-end': 'left',
      'inline-start': 'top',
      'inline-end': 'bottom'
    },
    {'block-size': 'width', 'inline-size': 'height'});

export const couplingMapHor = buildCouplingMap(
    {
      'block-start': 'top',
      'block-end': 'bottom',
      'inline-start': 'left',
      'inline-end': 'right'
    },
    {'block-size': 'height', 'inline-size': 'width'});

export const couplingMapVertRtl = buildCouplingMap(
    {
      'block-start': 'right',
      'block-end': 'left',
      'inline-start': 'bottom',
      'inline-end': 'top'
    },
    {'block-size': 'width', 'inline-size': 'height'});

export const couplingMapHorRtl = buildCouplingMap(
    {
      'block-start': 'top',
      'block-end': 'bottom',
      'inline-start': 'right',
      'inline-end': 'left'
    },
    {'block-size': 'height', 'inline-size': 'width'});

export class CascadeValue {
  constructor(
      public readonly value: css.Val, public readonly priority: number) {}

  getBaseValue(): CascadeValue {
    return this;
  }

  filterValue(visitor: css.Visitor): CascadeValue {
    const value = this.value.visit(visitor);
    if (value === this.value) {
      return this;
    }
    return new CascadeValue(value, this.priority);
  }

  increaseSpecificity(specificity: number): CascadeValue {
    if (specificity == 0) {
      return this;
    }
    return new CascadeValue(this.value, this.priority + specificity);
  }

  evaluate(context: expr.Context, propName: string): css.Val {
    return cssparse.evaluateCSSToCSS(context, this.value, propName);
  }

  isEnabled(context: expr.Context): boolean true
}

/**
 * Internal subclass of CascadeValue. Should never be seen outside of the
 * cascade engine.
 */
export class ConditionalCascadeValue extends adapt.csscasc.CascadeValue {
  constructor(
      value: css.Val, priority: number, public readonly condition: expr.Val) {
    CascadeValue.call(this, value, priority);
  }

  /**
   * @override
   */
  getBaseValue() {
    return new CascadeValue(this.value, this.priority);
  }

  /**
   * @override
   */
  filterValue(visitor) {
    const value = this.value.visit(visitor);
    if (value === this.value) {
      return this;
    }
    return new ConditionalCascadeValue(value, this.priority, this.condition);
  }

  /**
   * @override
   */
  increaseSpecificity(specificity) {
    if (specificity == 0) {
      return this;
    }
    return new ConditionalCascadeValue(
        this.value, this.priority + specificity, this.condition);
  }

  isEnabled(context: expr.Context): boolean {
    return !!this.condition.evaluate(context);
  }
}
goog.inherits(ConditionalCascadeValue, CascadeValue);

/**
 * @param tv current value (cannot be conditional)
 * @param av cascaded value (can be conditional)
 */
export const cascadeValues =
    (context: expr.Context, tv: CascadeValue,
     av: CascadeValue): CascadeValue => {
      if ((tv == null || av.priority > tv.priority) && av.isEnabled(context)) {
        return av.getBaseValue();
      }
      return tv;
    };

/**
 * @dict
 */
export class ElementStyle {}
type ElementStyleMap = {
  [key: string]: ElementStyle
};

export {ElementStyleMap};

export const SPECIALS = {
  'region-id': true,
  'fragment-selector-id': true
};

export const isSpecialName = (name: string) => !!SPECIALS[name];

export const isMapName = (name: string) => name.charAt(0) == '_';

export const isPropName = (name: string) =>
    name.charAt(0) != '_' && !SPECIALS[name];

export const isInherited = (name: string): boolean => !!inheritedProps[name];

export const getProp = (style: ElementStyle, name: string): CascadeValue =>
    (style[name] as CascadeValue);

/**
 * @return void
 */
export const setProp =
    (style: ElementStyle, name: string, value: CascadeValue): any => {
      if (!value) {
        delete style[name];
      } else {
        style[name] = value;
      }
    };

export const getStyleMap =
    (style: ElementStyle, name: string): ElementStyleMap =>
        (style[name] as ElementStyleMap);

export const getMutableStyleMap =
    (style: ElementStyle, name: string): ElementStyleMap => {
      let r = (style[name] as ElementStyleMap);
      if (!r) {
        r = {};
        style[name] = r;
      }
      return r;
    };

export const getViewConditionalStyleMap =
    (style: ElementStyle): {matcher: Matcher, styles: ElementStyleMap}[] => {
      let r =
          (style['_viewConditionalStyles'] as
           {matcher: Matcher, styles: ElementStyleMap}[]);
      if (!r) {
        r = [];
        style['_viewConditionalStyles'] = r;
      }
      return r;
    };

export const getSpecial = (style: ElementStyle, name: string): CascadeValue[] =>
    (style[name] as CascadeValue[]);

export const getMutableSpecial =
    (style: ElementStyle, name: string): CascadeValue[] => {
      let r = (style[name] as CascadeValue[]);
      if (!r) {
        r = [];
        style[name] = r;
      }
      return r;
    };

export const mergeIn =
    (context: expr.Context, target: ElementStyle, style: ElementStyle,
     specificity: number, pseudoelement: string|null, regionId: string|null,
     viewConditionMatcher: Matcher|null): void => {
      const hierarchy = [
        {id: pseudoelement, styleKey: '_pseudos'},
        {id: regionId, styleKey: '_regions'}
      ];
      hierarchy.forEach((item) => {
        if (item.id) {
          const styleMap = getMutableStyleMap(target, item.styleKey);
          target = styleMap[item.id];
          if (!target) {
            target = ({} as ElementStyle);
            styleMap[item.id] = target;
          }
        }
      });
      if (viewConditionMatcher) {
        const styleMap = getViewConditionalStyleMap(target);
        target = ({} as ElementStyle);
        styleMap.push({styles: target, matcher: viewConditionMatcher});
      }
      for (const prop in style) {
        if (isMapName(prop)) {
          continue;
        }
        if (isSpecialName(prop)) {
          // special properties: list of all assigned values
          const as = getSpecial(style, prop);
          const ts = getMutableSpecial(target, prop);
          Array.prototype.push.apply(ts, as);
        } else {
          // regular properties: higher priority wins
          const av = getProp(style, prop).increaseSpecificity(specificity);
          const tv = getProp(target, prop);
          setProp(target, prop, cascadeValues(context, tv, av));
        }
      }
    };

export const mergeAll =
    (context: expr.Context, styles: ElementStyle[]): ElementStyle => {
      const target = ({} as ElementStyle);
      for (let k = 0; k < styles.length; k++) {
        mergeIn(context, target, styles[k], 0, null, null, null);
      }
      return target;
    };

export const chainActions =
    (chain: ChainedAction[], action: CascadeAction): CascadeAction => {
      if (chain.length > 0) {
        chain.sort((a, b) => b.getPriority() - a.getPriority());
        let chained = null;
        for (let i = chain.length - 1; i >= 0; i--) {
          chained = chain[i];
          chained.chained = action;
          action = chained;
        }
        return chained;
      }
      return action;
    };

export class InheritanceVisitor extends adapt.css.FilterVisitor {
  propName: string = '';

  constructor(
      public readonly props: ElementStyle,
      public readonly context: expr.Context) {
    css.Visitor.call(this);
  }

  setPropName(name: string): void {
    this.propName = name;
  }

  private getFontSize() {
    const cascval = getProp(this.props, 'font-size');
    const n = (cascval.value as css.Numeric);
    if (!expr.isAbsoluteLengthUnit(n.unit)) {
      throw new Error('Unexpected state');
    }
    return n.num * expr.defaultUnitSizes[n.unit];
  }

  /**
   * @override
   */
  visitNumeric(numeric) {
    goog.asserts.assert(this.context);
    if (this.propName === 'font-size') {
      return convertFontSizeToPx(numeric, this.getFontSize(), this.context);
    } else {
      if (numeric.unit == 'em' || numeric.unit == 'ex' ||
          numeric.unit == 'rem') {
        return convertFontRelativeLengthToPx(
            numeric, this.getFontSize(), this.context);
      } else {
        if (numeric.unit == '%') {
          if (this.propName === 'line-height') {
            return numeric;
          }
          const unit =
              this.propName.match(/height|^(top|bottom)$/) ? 'vh' : 'vw';
          return new css.Numeric(numeric.num, unit);
        }
      }
    }
    return numeric;
  }

  /**
   * @override
   */
  visitExpr(expr) {
    if (this.propName == 'font-size') {
      const val = cssparse.evaluateCSSToCSS(this.context, expr, this.propName);
      return val.visit(this);
    }
    return expr;
  }
}
goog.inherits(InheritanceVisitor, css.FilterVisitor);

export const convertFontRelativeLengthToPx =
    (numeric: css.Numeric, baseFontSize: number,
     context: expr.Context): css.Numeric => {
      const unit = numeric.unit;
      const num = numeric.num;
      if (unit === 'em' || unit === 'ex') {
        const ratio = expr.defaultUnitSizes[unit] / expr.defaultUnitSizes['em'];
        return new css.Numeric(num * ratio * baseFontSize, 'px');
      } else {
        if (unit === 'rem') {
          return new css.Numeric(num * context.fontSize(), 'px');
        } else {
          return numeric;
        }
      }
    };

export const convertFontSizeToPx = (numeric: css.Numeric,
                                    parentFontSize: number,
                                    context: expr.Context): css.Numeric => {
  numeric = convertFontRelativeLengthToPx(numeric, parentFontSize, context);
  const unit = numeric.unit;
  const num = numeric.num;
  if (unit === 'px') {
    return numeric;
  } else {
    if (unit === '%') {
      return new css.Numeric(num / 100 * parentFontSize, 'px');
    } else {
      return new css.Numeric(num * context.queryUnitSize(unit, false), 'px');
    }
  }
};
type ActionTable = {
  [key: string]: CascadeAction
};

export {ActionTable};

export class CascadeAction {
  apply(cascade: CascadeInstance): void {}

  mergeWith(other: CascadeAction): CascadeAction {
    return new CompoundAction([this, other]);
  }

  clone(): CascadeAction {
    // Mutable actions will override
    return this;
  }
}

export class ConditionItemAction extends adapt.csscasc.CascadeAction {
  constructor(public readonly conditionItem: ConditionItem) {
    CascadeAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    cascadeInstance.pushConditionItem(
        this.conditionItem.fresh(cascadeInstance));
  }
}
goog.inherits(ConditionItemAction, CascadeAction);

export class CompoundAction extends adapt.csscasc.CascadeAction {
  constructor(public readonly list: CascadeAction[]) {
    CascadeAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    for (let i = 0; i < this.list.length; i++) {
      this.list[i].apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  mergeWith(other) {
    this.list.push(other);
    return this;
  }

  /**
   * @override
   */
  clone() {
    return new CompoundAction([].concat(this.list));
  }
}
goog.inherits(CompoundAction, CascadeAction);

export class ApplyRuleAction extends adapt.csscasc.CascadeAction {
  constructor(
      public readonly style: ElementStyle, public readonly specificity: number,
      public readonly pseudoelement: string|null,
      public readonly regionId: string|null,
      public readonly viewConditionId: string|null) {
    CascadeAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    mergeIn(
        cascadeInstance.context, cascadeInstance.currentStyle, this.style,
        this.specificity, this.pseudoelement, this.regionId,
        cascadeInstance.buildViewConditionMatcher(this.viewConditionId));
  }
}
goog.inherits(ApplyRuleAction, CascadeAction);

export class ChainedAction extends adapt.csscasc.CascadeAction {
  chained: CascadeAction = null;

  constructor() {
    CascadeAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    this.chained.apply(cascadeInstance);
  }

  getPriority(): number 0

  makePrimary(cascade: Cascade): boolean
  // cannot be made primary
  false
}
goog.inherits(ChainedAction, CascadeAction);

export class CheckClassAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly className: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentClassNames.includes(this.className)) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority()
  // class should be checked after id
  10

  /**
   * @override
   */
  makePrimary(cascade) {
    if (this.chained) {
      cascade.insertInTable(cascade.classes, this.className, this.chained);
    }
    return true;
  }
}
goog.inherits(CheckClassAction, ChainedAction);

export class CheckIdAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly id: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentId == this.id ||
        cascadeInstance.currentXmlId == this.id) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority()
  // id should be checked after :root
  11

  /**
   * @override
   */
  makePrimary(cascade) {
    if (this.chained) {
      cascade.insertInTable(cascade.ids, this.id, this.chained);
    }
    return true;
  }
}
goog.inherits(CheckIdAction, ChainedAction);

export class CheckLocalNameAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly localName: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentLocalName == this.localName) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority()
  // tag is a pretty good thing to check, after epub:type
  8

  /**
   * @override
   */
  makePrimary(cascade) {
    if (this.chained) {
      cascade.insertInTable(cascade.tags, this.localName, this.chained);
    }
    return true;
  }
}
goog.inherits(CheckLocalNameAction, ChainedAction);

export class CheckNSTagAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly ns: string, public readonly localName: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentLocalName == this.localName &&
        cascadeInstance.currentNamespace == this.ns) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority()
  // tag is a pretty good thing to check, after epub:type
  8

  /**
   * @override
   */
  makePrimary(cascade) {
    if (this.chained) {
      let prefix = cascade.nsPrefix[this.ns];
      if (!prefix) {
        prefix = `ns${cascade.nsCount++}:`;
        cascade.nsPrefix[this.ns] = prefix;
      }
      const nsTag = prefix + this.localName;
      cascade.insertInTable(cascade.nstags, nsTag, this.chained);
    }
    return true;
  }
}
goog.inherits(CheckNSTagAction, ChainedAction);

export class CheckTargetEpubTypeAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly epubTypePatt: RegExp) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    const elem = cascadeInstance.currentElement;
    if (elem && cascadeInstance.currentLocalName == 'a') {
      const href = elem.getAttribute('href');
      if (href && href.match(/^#/)) {
        const id = href.substring(1);
        const target = elem.ownerDocument.getElementById(id);
        if (target) {
          const epubType = target.getAttributeNS(adapt.base.NS.epub, 'type');
          if (epubType && epubType.match(this.epubTypePatt)) {
            this.chained.apply(cascadeInstance);
          }
        }
      }
    }
  }
}
goog.inherits(CheckTargetEpubTypeAction, ChainedAction);

export class CheckNamespaceAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly ns: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentNamespace == this.ns) {
      this.chained.apply(cascadeInstance);
    }
  }
}
goog.inherits(CheckNamespaceAction, ChainedAction);

export class CheckAttributePresentAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly ns: string, public readonly name: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentElement &&
        cascadeInstance.currentElement.hasAttributeNS(this.ns, this.name)) {
      this.chained.apply(cascadeInstance);
    }
  }
}
goog.inherits(CheckAttributePresentAction, ChainedAction);

export class CheckAttributeEqAction extends adapt.csscasc.ChainedAction {
  constructor(
      public readonly ns: string, public readonly name: string,
      public readonly value: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentElement &&
        cascadeInstance.currentElement.getAttributeNS(this.ns, this.name) ==
            this.value) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() {
    if (this.name == 'type' && this.ns == adapt.base.NS.epub) {
      return 9;
    }

    // epub:type is a pretty good thing to check
    return 0;
  }

  /**
   * @override
   */
  makePrimary(cascade) {
    if (this.name == 'type' && this.ns == adapt.base.NS.epub) {
      if (this.chained) {
        cascade.insertInTable(cascade.epubtypes, this.value, this.chained);
      }
      return true;
    }
    return false;
  }
}
goog.inherits(CheckAttributeEqAction, ChainedAction);

export class CheckNamespaceSupportedAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly ns: string, public readonly name: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentElement) {
      const ns =
          cascadeInstance.currentElement.getAttributeNS(this.ns, this.name);
      if (ns && supportedNamespaces[ns]) {
        this.chained.apply(cascadeInstance);
      }
    }
  }

  /**
   * @override
   */
  getPriority() 0

  /**
   * @override
   */
  makePrimary(cascade) false
}
goog.inherits(CheckNamespaceSupportedAction, ChainedAction);

export class CheckAttributeRegExpAction extends adapt.csscasc.ChainedAction {
  constructor(
      public readonly ns: string, public readonly name: string,
      public readonly regexp: RegExp) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.currentElement) {
      const attr =
          cascadeInstance.currentElement.getAttributeNS(this.ns, this.name);
      if (attr && attr.match(this.regexp)) {
        this.chained.apply(cascadeInstance);
      }
    }
  }
}
goog.inherits(CheckAttributeRegExpAction, ChainedAction);

export class CheckLangAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly langRegExp: RegExp) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.lang.match(this.langRegExp)) {
      this.chained.apply(cascadeInstance);
    }
  }
}
goog.inherits(CheckLangAction, ChainedAction);

export class IsFirstAction extends adapt.csscasc.ChainedAction {
  constructor() {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.isFirst) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 6
}
goog.inherits(IsFirstAction, ChainedAction);

export class IsRootAction extends adapt.csscasc.ChainedAction {
  constructor() {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.isRoot) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority()
  // :root is the first thing to check
  12
}
goog.inherits(IsRootAction, ChainedAction);

export class IsNthAction extends adapt.csscasc.ChainedAction {
  private constructor(public readonly a: number, public readonly b: number) {
    ChainedAction.call(this);
  }

  /**
   * Checkes whether given order can be represented as an+b with a non-negative
   * interger n
   */
  protected matchANPlusB(order: number): boolean {
    return matchANPlusB(order, this.a, this.b);
  }
}
goog.inherits(IsNthAction, ChainedAction);

/**
 * Checkes whether given order can be represented as an+b with a non-negative
 * interger n
 */
export const matchANPlusB = (order: number, a: number, b: number): boolean => {
  order -= b;
  if (a === 0) {
    return order === 0;
  } else {
    return order % a === 0 && order / a >= 0;
  }
};

export class IsNthSiblingAction extends adapt.csscasc.IsNthAction {
  constructor(a: number, b: number) {
    IsNthAction.call(this, a, b);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (this.matchANPlusB(cascadeInstance.currentSiblingOrder)) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 5
}
goog.inherits(IsNthSiblingAction, IsNthAction);

export class IsNthSiblingOfTypeAction extends adapt.csscasc.IsNthAction {
  constructor(a: number, b: number) {
    IsNthAction.call(this, a, b);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    const order =
        cascadeInstance
            .currentSiblingTypeCounts[cascadeInstance
                                          .currentNamespace][cascadeInstance
                                                                 .currentLocalName];
    if (this.matchANPlusB(order)) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 5
}
goog.inherits(IsNthSiblingOfTypeAction, IsNthAction);

export class IsNthLastSiblingAction extends adapt.csscasc.IsNthAction {
  constructor(a: number, b: number) {
    IsNthAction.call(this, a, b);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    let order = cascadeInstance.currentFollowingSiblingOrder;
    if (order === null) {
      order = cascadeInstance.currentFollowingSiblingOrder =
          cascadeInstance.currentElement.parentNode.childElementCount -
          cascadeInstance.currentSiblingOrder + 1;
    }
    if (this.matchANPlusB(order)) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 4
}
goog.inherits(IsNthLastSiblingAction, IsNthAction);

export class IsNthLastSiblingOfTypeAction extends adapt.csscasc.IsNthAction {
  constructor(a: number, b: number) {
    IsNthAction.call(this, a, b);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    const counts = cascadeInstance.currentFollowingSiblingTypeCounts;
    if (!counts[cascadeInstance.currentNamespace]) {
      let elem = cascadeInstance.currentElement;
      do {
        const ns = elem.namespaceURI;
        const localName = elem.localName;
        let nsCounts = counts[ns];
        if (!nsCounts) {
          nsCounts = counts[ns] = {};
        }
        nsCounts[localName] = (nsCounts[localName] || 0) + 1;
      } while (elem = elem.nextElementSibling);
    }
    if (this.matchANPlusB(counts[cascadeInstance.currentNamespace]
                                [cascadeInstance.currentLocalName])) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 4
}
goog.inherits(IsNthLastSiblingOfTypeAction, IsNthAction);

export class IsEmptyAction extends adapt.csscasc.ChainedAction {
  constructor() {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    let node = cascadeInstance.currentElement.firstChild;
    while (node) {
      switch (node.nodeType) {
        case Node.ELEMENT_NODE:
          return;
        case Node.TEXT_NODE:
          if ((node as Text).length > 0) {
            return;
          }
      }
      node = node.nextSibling;
    }
    this.chained.apply(cascadeInstance);
  }

  /**
   * @override
   */
  getPriority() 4
}
goog.inherits(IsEmptyAction, ChainedAction);

export class IsEnabledAction extends adapt.csscasc.ChainedAction {
  constructor() {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    const elem = cascadeInstance.currentElement;
    if (elem.disabled === false) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 5
}
goog.inherits(IsEnabledAction, ChainedAction);

export class IsDisabledAction extends adapt.csscasc.ChainedAction {
  constructor() {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    const elem = cascadeInstance.currentElement;
    if (elem.disabled === true) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 5
}
goog.inherits(IsDisabledAction, ChainedAction);

export class IsCheckedAction extends adapt.csscasc.ChainedAction {
  constructor() {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    const elem = cascadeInstance.currentElement;
    if (elem.selected === true || elem.checked === true) {
      this.chained.apply(cascadeInstance);
    }
  }

  /**
   * @override
   */
  getPriority() 5
}
goog.inherits(IsCheckedAction, ChainedAction);

export class CheckConditionAction extends adapt.csscasc.ChainedAction {
  constructor(public readonly condition: string) {
    ChainedAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    if (cascadeInstance.conditions[this.condition]) {
      try {
        cascadeInstance.dependentConditions.push(this.condition);
        this.chained.apply(cascadeInstance);
      } finally {
        cascadeInstance.dependentConditions.pop();
      }
    }
  }

  /**
   * @override
   */
  getPriority() 5
}
goog.inherits(CheckConditionAction, ChainedAction);

export class CheckAppliedAction extends adapt.csscasc.CascadeAction {
  applied: any = false;

  constructor() {
    CascadeAction.call(this);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    this.applied = true;
  }

  /**
   * @override
   */
  clone() {
    const cloned = new CheckAppliedAction();
    cloned.applied = this.applied;
    return cloned;
  }
}
goog.inherits(CheckAppliedAction, CascadeAction);

export class NegateActionsSet extends adapt.csscasc.ChainedAction {
  checkAppliedAction: any;
  firstAction: any;

  constructor(list: ChainedAction[]) {
    ChainedAction.call(this);
    this.checkAppliedAction = new CheckAppliedAction();
    this.firstAction = chainActions(list, this.checkAppliedAction);
  }

  /**
   * @override
   */
  apply(cascadeInstance) {
    this.firstAction.apply(cascadeInstance);
    if (!this.checkAppliedAction.applied) {
      this.chained.apply(cascadeInstance);
    }
    this.checkAppliedAction.applied = false;
  }

  /**
   * @override
   */
  getPriority() {
    return this.firstAction.getPriority();
  }
}
goog.inherits(NegateActionsSet, ChainedAction);

/**
 * An object that is notified as elements are pushed and popped and typically
 * controls a "named condition" (which is a count associated with a name).
 */
export interface ConditionItem {
  /**
   * Returns a "fresh" copy of this item. May be this if immutable.
   */
  fresh(cascadeInstance: CascadeInstance): ConditionItem;

  /**
   * Depth is 0 for element itself and its siblings, 1 for direct children and
   * -1 for the parent.
   */
  push(cascadeInstance: CascadeInstance, depth: number): boolean;

  /**
   * @return return true if no more notifications are desired
   */
  pop(cascadeInstance: CascadeInstance, depth: number): boolean;
}

export class AbstractConditionItem {
  constructor(
      public readonly condition: string,
      public readonly viewConditionId: string|null,
      public readonly viewCondition: Matcher) {}

  increment(cascade: CascadeInstance) {
    cascade.increment(this.condition, this.viewCondition);
  }

  decrement(cascade: CascadeInstance) {
    cascade.decrement(this.condition, this.viewCondition);
  }

  buildViewConditionMatcher(cascade: CascadeInstance): Matcher {
    return cascade.buildViewConditionMatcher(this.viewConditionId);
  }
}

export class DescendantConditionItem extends
    adapt.csscasc.AbstractConditionItem implements ConditionItem {
  constructor(
      condition: string, viewConditionId: string|null, viewCondition: Matcher) {
    AbstractConditionItem.call(this, condition, viewConditionId, viewCondition);
  }

  /**
   * @override
   */
  fresh(cascade) {
    return new DescendantConditionItem(
        this.condition, this.viewConditionId,
        this.buildViewConditionMatcher(cascade));
  }

  /**
   * @override
   */
  push(cascade, depth) {
    if (depth == 0) {
      this.increment(cascade);
    }
    return false;
  }

  /**
   * @override
   */
  pop(cascade, depth) {
    if (depth == 0) {
      this.decrement(cascade);
      return true;
    }
    return false;
  }
}
goog.inherits(DescendantConditionItem, AbstractConditionItem);

export class ChildConditionItem extends
    adapt.csscasc.AbstractConditionItem implements ConditionItem {
  constructor(
      condition: string, viewConditionId: string|null, viewCondition: Matcher) {
    AbstractConditionItem.call(this, condition, viewConditionId, viewCondition);
  }

  /**
   * @override
   */
  fresh(cascade) {
    return new ChildConditionItem(
        this.condition, this.viewConditionId,
        this.buildViewConditionMatcher(cascade));
  }

  /**
   * @override
   */
  push(cascade, depth) {
    if (depth == 0) {
      this.increment(cascade);
    } else {
      if (depth == 1) {
        this.decrement(cascade);
      }
    }
    return false;
  }

  /**
   * @override
   */
  pop(cascade, depth) {
    if (depth == 0) {
      this.decrement(cascade);
      return true;
    } else {
      if (depth == 1) {
        this.increment(cascade);
      }
    }
    return false;
  }
}
goog.inherits(ChildConditionItem, AbstractConditionItem);

export class AdjacentSiblingConditionItem extends
    adapt.csscasc.AbstractConditionItem implements ConditionItem {
  fired: boolean = false;

  constructor(
      condition: string, viewConditionId: string|null, viewCondition: Matcher) {
    AbstractConditionItem.call(this, condition, viewConditionId, viewCondition);
  }

  /**
   * @override
   */
  fresh(cascade) {
    return new AdjacentSiblingConditionItem(
        this.condition, this.viewConditionId,
        this.buildViewConditionMatcher(cascade));
  }

  /**
   * @override
   */
  push(cascade, depth) {
    if (this.fired) {
      this.decrement(cascade);
      return true;
    }
    return false;
  }

  /**
   * @override
   */
  pop(cascade, depth) {
    if (this.fired) {
      this.decrement(cascade);
      return true;
    }
    if (depth == 0) {
      // Leaving element that triggered this item.
      this.fired = true;
      this.increment(cascade);
    }
    return false;
  }
}
goog.inherits(AdjacentSiblingConditionItem, AbstractConditionItem);

export class FollowingSiblingConditionItem extends
    adapt.csscasc.AbstractConditionItem implements ConditionItem {
  fired: boolean = false;

  constructor(
      condition: string, viewConditionId: string|null, viewCondition: Matcher) {
    AbstractConditionItem.call(this, condition, viewConditionId, viewCondition);
  }

  /**
   * @override
   */
  fresh(cascade) {
    return new FollowingSiblingConditionItem(
        this.condition, this.viewConditionId,
        this.buildViewConditionMatcher(cascade));
  }

  /**
   * @override
   */
  push(cascade, depth) {
    if (this.fired) {
      if (depth == -1) {
        this.increment(cascade);
      } else {
        if (depth == 0) {
          this.decrement(cascade);
        }
      }
    }
    return false;
  }

  /**
   * @override
   */
  pop(cascade, depth) {
    if (this.fired) {
      if (depth == -1) {
        this.decrement(cascade);
        return true;
      } else {
        if (depth == 0) {
          this.increment(cascade);
        }
      }
    } else {
      if (depth == 0) {
        // Leaving element that triggered this item.
        this.fired = true;
        this.increment(cascade);
      }
    }
    return false;
  }
}
goog.inherits(FollowingSiblingConditionItem, AbstractConditionItem);

/**
 * Not a true condition item, this class manages proper handling of "after"
 * pseudoelement.
 */
export class AfterPseudoelementItem implements ConditionItem {
  constructor(
      public readonly afterprop: ElementStyle,
      public readonly element: Element) {}

  /**
   * @override
   */
  fresh() {
    return this;
  }

  /**
   * @override
   */
  push(cascade, depth) false

  /**
   * @override
   */
  pop(cascade, depth) {
    if (depth == 0) {
      cascade.processPseudoelementProps(this.afterprop, this.element);
      return true;
    }
    return false;
  }
}

/**
 * Not a true condition item, this class restores current language.
 */
export class RestoreLangItem implements ConditionItem {
  constructor(public readonly lang: string) {}

  /**
   * @override
   */
  fresh() {
    return this;
  }

  /**
   * @override
   */
  push(cascade, depth) false

  /**
   * @override
   */
  pop(cascade, depth) {
    if (depth == 0) {
      cascade.lang = this.lang;
      return true;
    }
    return false;
  }
}

/**
 * Not a true condition item, this class manages inheritance of quotes property
 */
export class QuotesScopeItem implements ConditionItem {
  constructor(public readonly oldQuotes: css.Str[]) {}

  /**
   * @override
   */
  fresh() {
    return this;
  }

  /**
   * @override
   */
  push(cascade, depth) false

  /**
   * @override
   */
  pop(cascade, depth) {
    if (depth == 0) {
      cascade.quotes = this.oldQuotes;
      return true;
    }
    return false;
  }
}
type CounterValues = {
  [key: string]: number[]
};

export {CounterValues};

export interface CounterListener {
  countersOfId(id: string, counters: CounterValues);

  getExprContentListener(): ExprContentListener;
}

export interface CounterResolver {
  /**
   * Returns an adapt.expr.Val, whose value is calculated at the layout time by
   * retrieving the innermost page-based counter (null if it does not exist) by
   * its name and formatting the value into a string.
   * @param name Name of the page-based counter to be retrieved
   * @param format A function that formats the counter value into a string
   */
  getPageCounterVal(name: string, format: (p1: number|null) => string):
      expr.Val;

  /**
   * Returns an adapt.expr.Val, whose value is calculated at the layout time by
   * retrieving the page-based counters by its name and formatting the values
   * into a string.
   * @param name Name of the page-based counters to be retrieved
   * @param format A function that formats the counter values (passed as an
   *     array ordered by the nesting depth with the outermost counter first and
   *     the innermost last) into a string
   */
  getPageCountersVal(name: string, format: (p1: number[]) => string): expr.Val;

  getTargetCounterVal(
      url: string, name: string, format: (p1: number|null) => string): expr.Val;

  getTargetCountersVal(
      url: string, name: string, format: (p1: number[]) => string): expr.Val;
}

export class AttrValueFilterVisitor extends adapt.css.FilterVisitor {
  element: any;

  constructor(element: Element) {
    css.FilterVisitor.call(this);
    this.element = element;
  }

  private createValueFromString(str: string|null, type: string): css.Val {
    switch (type) {
      case 'url':
        if (str) {
          return new css.URL(str);
        }

        // TODO should convert to absolute path
        return new css.URL('about:invalid');
        break;
      case 'string':
      default:
        if (str) {
          return new css.Str(str);
        }
        return new css.Str('');
        break;
    }
  }

  /**
   * @override
   */
  visitFunc(func) {
    if (func.name !== 'attr') {
      return css.FilterVisitor.prototype.visitFunc.call(this, func);
    }
    let type = 'string';
    let attributeName = null;
    let defaultValue: css.Val = null;
    if (func.values[0] instanceof css.SpaceList) {
      if (func.values[0].values.length >= 2) {
        type = func.values[0].values[1].stringValue();
      }
      attributeName = func.values[0].values[0].stringValue();
    } else {
      attributeName = func.values[0].stringValue();
    }
    if (func.values.length > 1) {
      defaultValue =
          this.createValueFromString(func.values[1].stringValue(), type);
    } else {
      defaultValue = this.createValueFromString(null, type);
    }
    if (this.element && this.element.hasAttribute(attributeName)) {
      return this.createValueFromString(
          this.element.getAttribute(attributeName), type);
    }
    return defaultValue;
  }
}
goog.inherits(AttrValueFilterVisitor, css.FilterVisitor);

export class ContentPropVisitor extends adapt.css.FilterVisitor {
  cascade: any;
  element: any;

  constructor(
      cascade: CascadeInstance, element: Element,
      public readonly counterResolver: CounterResolver) {
    css.FilterVisitor.call(this);
    this.cascade = cascade;
    this.element = element;
  }

  /**
   * @override
   */
  visitIdent(ident) {
    const cascade = this.cascade;
    const quotes = cascade.quotes;
    const maxDepth = Math.floor(quotes.length / 2) - 1;
    switch (ident.name) {
      case 'open-quote':
        const result = quotes[2 * Math.min(maxDepth, cascade.quoteDepth)];
        cascade.quoteDepth++;
        return result;
      case 'close-quote':
        if (cascade.quoteDepth > 0) {
          cascade.quoteDepth--;
        }
        return quotes[2 * Math.min(maxDepth, cascade.quoteDepth) + 1];
      case 'no-open-quote':
        cascade.quoteDepth++;
        return new css.Str('');
      case 'no-close-quote':
        if (cascade.quoteDepth > 0) {
          cascade.quoteDepth--;
        }
        return new css.Str('');
    }
    return ident;
  }

  private format(num: number, type: string): string {
    let upper = false;

    // type == "armenian"; // content-counter-10.xht assumes armenian is
    // uppercase, enable if desired
    let lower = false;
    let r;
    if ((r = type.match(/^upper-(.*)/)) != null) {
      upper = true;
      type = r[1];
    } else {
      if ((r = type.match(/^lower-(.*)/)) != null) {
        lower = true;
        type = r[1];
      }
    }
    let result = '';
    if (additiveNumbering[type]) {
      result = additiveFormat(additiveNumbering[type], num);
    } else {
      if (alphabeticNumbering[type]) {
        result = alphabeticFormat(alphabeticNumbering[type], num);
      } else {
        if (fixed[type] != null) {
          result = fixed[type];
        } else {
          if (type == 'decimal-leading-zero') {
            result = `${num}`;
            if (result.length == 1) {
              result = `0${result}`;
            }
          } else {
            if (type == 'cjk-ideographic' || type == 'trad-chinese-informal') {
              result = chineseCounter(num, chineseTradInformal);
            } else {
              result = `${num}`;
            }
          }
        }
      }
    }
    if (upper) {
      return result.toUpperCase();
    }
    if (lower) {
      return result.toLowerCase();
    }
    return result;
  }

  visitFuncCounter(values: css.Val[]): css.Val {
    const counterName = values[0].toString();
    const type = values.length > 1 ? values[1].stringValue() : 'decimal';
    const arr = this.cascade.counters[counterName];
    if (arr && arr.length) {
      const numval = arr && arr.length && arr[arr.length - 1] || 0;
      return new css.Str(this.format(numval, type));
    } else {
      const self = this;
      const c = new css.Expr(this.counterResolver.getPageCounterVal(
          counterName, (numval) => self.format(numval || 0, type)));
      return new css.SpaceList([c]);
    }
  }

  visitFuncCounters(values: css.Val[]): css.Val {
    const counterName = values[0].toString();
    const separator = values[1].stringValue();
    const type = values.length > 2 ? values[2].stringValue() : 'decimal';
    const arr = this.cascade.counters[counterName];
    const sb = new adapt.base.StringBuffer();
    if (arr && arr.length) {
      for (let i = 0; i < arr.length; i++) {
        if (i > 0) {
          sb.append(separator);
        }
        sb.append(this.format(arr[i], type));
      }
    }
    const self = this;
    const c = new css.Expr(
        this.counterResolver.getPageCountersVal(counterName, (numvals) => {
          const parts = ([] as string[]);
          if (numvals.length) {
            for (let i = 0; i < numvals.length; i++) {
              parts.push(self.format(numvals[i], type));
            }
          }
          const elementCounters = sb.toString();
          if (elementCounters.length) {
            parts.push(elementCounters);
          }
          if (parts.length) {
            return parts.join(separator);
          } else {
            return self.format(0, type);
          }
        }));
    return new css.SpaceList([c]);
  }

  visitFuncTargetCounter(values: css.Val[]): css.Val {
    const targetUrl = values[0];
    let targetUrlStr;
    if (targetUrl instanceof css.URL) {
      targetUrlStr = targetUrl.url;
    } else {
      targetUrlStr = targetUrl.stringValue();
    }
    const counterName = values[1].toString();
    const type = values.length > 2 ? values[2].stringValue() : 'decimal';
    const self = this;
    const c = new css.Expr(this.counterResolver.getTargetCounterVal(
        targetUrlStr, counterName, (numval) => self.format(numval || 0, type)));
    return new css.SpaceList([c]);
  }

  visitFuncTargetCounters(values: css.Val[]): css.Val {
    const targetUrl = values[0];
    let targetUrlStr;
    if (targetUrl instanceof css.URL) {
      targetUrlStr = targetUrl.url;
    } else {
      targetUrlStr = targetUrl.stringValue();
    }
    const counterName = values[1].toString();
    const separator = values[2].stringValue();
    const type = values.length > 3 ? values[3].stringValue() : 'decimal';
    const self = this;
    const c = new css.Expr(this.counterResolver.getTargetCountersVal(
        targetUrlStr, counterName, (numvals) => {
          const parts = numvals.map((numval) => self.format(numval, type));
          if (parts.length) {
            return parts.join(separator);
          } else {
            return self.format(0, type);
          }
        }));
    return new css.SpaceList([c]);
  }

  /**
   * @override
   */
  visitFunc(func) {
    switch (func.name) {
      case 'counter':
        if (func.values.length <= 2) {
          return this.visitFuncCounter(func.values);
        }
        break;
      case 'counters':
        if (func.values.length <= 3) {
          return this.visitFuncCounters(func.values);
        }
        break;
      case 'target-counter':
        if (func.values.length <= 3) {
          return this.visitFuncTargetCounter(func.values);
        }
        break;
      case 'target-counters':
        if (func.values.length <= 4) {
          return this.visitFuncTargetCounters(func.values);
        }
        break;
    }
    logging.logger.warn('E_CSS_CONTENT_PROP:', func.toString());
    return new css.Str('');
  }
}
goog.inherits(ContentPropVisitor, css.FilterVisitor);

export const roman = (num) => {
  if (num <= 0 || num != Math.round(num) || num > 3999) {
    return '';
  }
  const digits = ['I', 'V', 'X', 'L', 'C', 'D', 'M'];
  let offset = 0;
  let acc = '';
  while (num > 0) {
    let digit = num % 10;
    num = (num - digit) / 10;
    let result = '';
    if (digit == 9) {
      result += digits[offset] + digits[offset + 2];
    } else {
      if (digit == 4) {
        result += digits[offset] + digits[offset + 1];
      } else {
        if (digit >= 5) {
          result += digits[offset + 1];
          digit -= 5;
        }
        while (digit > 0) {
          result += digits[offset];
          digit--;
        }
      }
    }
    acc = result + acc;
    offset += 2;
  }
  return acc;
};

export const additiveNumbering = {
  'roman': [
    4999, 1000, 'M',  900, 'CM', 500, 'D',  400, 'CD', 100, 'C',  90, 'XC', 50,
    'L',  40,   'XL', 10,  'X',  9,   'IX', 5,   'V',  4,   'IV', 1,  'I'
  ],
  'armenian': [
    9999,     9000, '\u0584', 8000, '\u0583', 7000, '\u0582', 6000,
    '\u0581', 5000, '\u0580', 4000, '\u057f', 3000, '\u057e', 2000,
    '\u057d', 1000, '\u057c', 900,  '\u057b', 800,  '\u057a', 700,
    '\u0579', 600,  '\u0578', 500,  '\u0577', 400,  '\u0576', 300,
    '\u0575', 200,  '\u0574', 100,  '\u0573', 90,   '\u0572', 80,
    '\u0571', 70,   '\u0570', 60,   '\u056f', 50,   '\u056e', 40,
    '\u056d', 30,   '\u056c', 20,   '\u056b', 10,   '\u056a', 9,
    '\u0569', 8,    '\u0568', 7,    '\u0567', 6,    '\u0566', 5,
    '\u0565', 4,    '\u0564', 3,    '\u0563', 2,    '\u0562', 1,
    '\u0561'
  ],
  'georgian': [
    19999,    10000, '\u10f5', 9000, '\u10f0', 8000, '\u10ef', 7000,
    '\u10f4', 6000,  '\u10ee', 5000, '\u10ed', 4000, '\u10ec', 3000,
    '\u10eb', 2000,  '\u10ea', 1000, '\u10e9', 900,  '\u10e8', 800,
    '\u10e7', 700,   '\u10e6', 600,  '\u10e5', 500,  '\u10e4', 400,
    '\u10f3', 300,   '\u10e2', 200,  '\u10e1', 100,  '\u10e0', 90,
    '\u10df', 80,    '\u10de', 70,   '\u10dd', 60,   '\u10f2', 50,
    '\u10dc', 40,    '\u10db', 30,   '\u10da', 20,   '\u10d9', 10,
    '\u10d8', 9,     '\u10d7', 8,    '\u10f1', 7,    '\u10d6', 6,
    '\u10d5', 5,     '\u10d4', 4,    '\u10d3', 3,    '\u10d2', 2,
    '\u10d1', 1,     '\u10d0'
  ],
  'hebrew': [
    999,
    400,
    '\u05ea',
    300,
    '\u05e9',
    200,
    '\u05e8',
    100,
    '\u05e7',
    90,
    '\u05e6',
    80,
    '\u05e4',
    70,
    '\u05e2',
    60,
    '\u05e1',
    50,
    '\u05e0',
    40,
    '\u05de',
    30,
    '\u05dc',
    20,
    '\u05db',
    19,
    '\u05d9\u05d8',
    18,
    '\u05d9\u05d7',
    17,
    '\u05d9\u05d6',
    16,
    '\u05d8\u05d6',
    15,
    '\u05d8\u05d5',
    10,
    '\u05d9',
    9,
    '\u05d8',
    8,
    '\u05d7',
    7,
    '\u05d6',
    6,
    '\u05d5',
    5,
    '\u05d4',
    4,
    '\u05d3',
    3,
    '\u05d2',
    2,
    '\u05d1',
    1,
    '\u05d0'
  ]
};

export const alphabeticNumbering = {
  'latin': 'a-z',
  'alpha': 'a-z',
  'greek': '\u03b1-\u03c1\u03c3-\u03c9',
  'russian': '\u0430-\u0438\u043a-\u0449\u044d-\u044f'
};

export const fixed = {
  'square': '\u25a0',
  'disc': '\u2022',
  'circle': '\u25e6',
  'none': ''
};

export const additiveFormat = (entries: Array, num: number) => {
  const max = (entries[0] as number);
  if (num > max || num <= 0 || num != Math.round(num)) {
    return '';
  }
  let result = '';
  for (let i = 1; i < entries.length; i += 2) {
    const value = (entries[i] as number);
    let count = Math.floor(num / value);
    if (count > 20) {
      return '';
    }
    num -= count * value;
    while (count > 0) {
      result += entries[i + 1];
      count--;
    }
  }
  return result;
};

export const expandAlphabet = (str) => {
  const arr = [];
  let i = 0;
  while (i < str.length) {
    if (str.substr(i + 1, 1) == '-') {
      const first = str.charCodeAt(i);
      const last = str.charCodeAt(i + 2);
      i += 3;
      for (let k = first; k <= last; k++) {
        arr.push(String.fromCharCode(k));
      }
    } else {
      arr.push(str.substr(i++, 1));
    }
  }
  return arr;
};

export const alphabeticFormat = (alphabetStr: String, num: number) => {
  if (num <= 0 || num != Math.round(num)) {
    return '';
  }
  const alphabet = expandAlphabet(alphabetStr);
  let result = '';
  do {
    num--;
    const digit = num % alphabet.length;
    result = alphabet[digit] + result;
    num = (num - digit) / alphabet.length;
  } while (num > 0);
  return result;
};
type ChineseNumbering = {
  digits: string,
  markers: string,
  negative: string,
  formal: boolean
};

export {ChineseNumbering};

/**
 * From http://www.w3.org/TR/css3-lists/
 */
export const chineseTradInformal: ChineseNumbering = {
  formal: false,
  digits: '\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d',
  markers: '\u5341\u767e\u5343',
  negative: '\u8ca0'
};

export const chineseCounter = (num: number, numbering: ChineseNumbering) => {
  if (num > 9999 || num < -9999) {
    return `${num}`;
  }

  // TODO: should be cjk-decimal
  if (num == 0) {
    return numbering.digits.charAt(0);
  }
  const res = new adapt.base.StringBuffer();
  if (num < 0) {
    res.append(numbering.negative);
    num = -num;
  }
  if (num < 10) {
    res.append(numbering.digits.charAt(num));
  } else {
    if (numbering.informal && num <= 19) {
      res.append(numbering.markers.charAt(0));
      if (num != 0) {
        res.append(numbering.markers.charAt(num - 10));
      }
    } else {
      const thousands = Math.floor(num / 1000);
      if (thousands) {
        res.append(numbering.digits.charAt(thousands));
        res.append(numbering.markers.charAt(2));
      }
      const hundreds = Math.floor(num / 100) % 10;
      if (hundreds) {
        res.append(numbering.digits.charAt(hundreds));
        res.append(numbering.markers.charAt(1));
      }
      const tens = Math.floor(num / 10) % 10;
      if (tens) {
        res.append(numbering.digits.charAt(tens));
        res.append(numbering.markers.charAt(0));
      }
      const ones = num % 10;
      if (ones) {
        res.append(numbering.digits.charAt(ones));
      }
    }
  }

  // res.append("\u3001");
  return res.toString();
};

/**
 * Fitting order and specificity in the same number. Order is recorded in the
 * fractional part. Select value so that
 *
 *   0x7FFFFFFF != 0x7FFFFFFF + ORDER_INCREMENT
 *
 */
export const ORDER_INCREMENT = 1 / 1048576;

export const copyTable = (src: ActionTable, dst: ActionTable): void => {
  for (const n in src) {
    dst[n] = src[n].clone();
  }
};

export class Cascade {
  nsCount: number = 0;
  nsPrefix: {[key: string]: string} = {};
  tags: ActionTable = {};
  nstags: ActionTable = {};
  epubtypes: ActionTable = {};
  classes: ActionTable = {};
  ids: ActionTable = {};
  pagetypes: ActionTable = {};
  order: number = 0;

  clone(): Cascade {
    const r = new Cascade();
    r.nsCount = this.nsCount;
    for (const p in this.nsPrefix) {
      r.nsPrefix[p] = this.nsPrefix[p];
    }
    copyTable(this.tags, r.tags);
    copyTable(this.nstags, r.nstags);
    copyTable(this.epubtypes, r.epubtypes);
    copyTable(this.classes, r.classes);
    copyTable(this.ids, r.ids);
    copyTable(this.pagetypes, r.pagetypes);
    r.order = this.order;
    return r;
  }

  insertInTable(table: ActionTable, key: string, action: CascadeAction): void {
    const a = table[key];
    if (a) {
      action = a.mergeWith(action);
    }
    table[key] = action;
  }

  createInstance(
      context: expr.Context, counterListener: CounterListener,
      counterResolver: CounterResolver, lang): CascadeInstance {
    return new CascadeInstance(
        this, context, counterListener, counterResolver, lang);
  }

  nextOrder(): number {
    return this.order += ORDER_INCREMENT;
  }
}

export class CascadeInstance {
  code: any;
  stack: any = ([[], []] as ConditionItem[][]);
  conditions: any = ({} as {[key: string]: number});
  currentElement: Element = null;
  currentElementOffset: number|null = null;
  currentStyle: ElementStyle = null;
  currentClassNames: string[] = null;
  currentLocalName: string = '';
  currentNamespace: string = '';
  currentId: string = '';
  currentXmlId: string = '';
  currentNSTag: string = '';
  currentEpubTypes: string[] = null;
  currentPageType: string|null = null;
  isFirst: boolean = true;
  isRoot: boolean = true;
  counters: {[key: string]: number[]} = {};
  counterScoping: ({[key: string]: boolean})[] = [{}];
  quotes: css.Str[];
  quoteDepth: number = 0;
  lang: string = '';
  siblingOrderStack: number[] = [0];
  currentSiblingOrder: number = 0;
  siblingTypeCountsStack: ({[key: string]: {[key: string]: number}})[] = [{}];
  currentSiblingTypeCounts: {[key: string]: {[key: string]: number}};
  currentFollowingSiblingOrder: number|null = null;
  followingSiblingOrderStack: (number|null)[];
  followingSiblingTypeCountsStack:
      ({[key: string]: {[key: string]: number}})[] = [{}];
  currentFollowingSiblingTypeCounts: {[key: string]: {[key: string]: number}};
  viewConditions: {[key: string]: Matcher[]} = {};
  dependentConditions: string[] = [];
  elementStack: Element[] = [];
  currentDoc: any;

  constructor(
      cascade: Cascade, public readonly context: expr.Context,
      public readonly counterListener: CounterListener,
      public readonly counterResolver: CounterResolver, lang: string) {
    this.code = cascade;
    this.quotes = [
      new css.Str('\u201c'), new css.Str('\u201d'), new css.Str('\u2018'),
      new css.Str('\u2019')
    ];
    this.currentSiblingTypeCounts = this.siblingTypeCountsStack[0];
    this.followingSiblingOrderStack = [this.currentFollowingSiblingOrder];
    this.currentFollowingSiblingTypeCounts = this.siblingTypeCountsStack[0];
    if (goog.DEBUG) {
    }
  }

  pushConditionItem(item: ConditionItem): void {
    this.stack[this.stack.length - 1].push(item);
  }

  increment(condition: string, viewCondition: Matcher): void {
    this.conditions[condition] = (this.conditions[condition] || 0) + 1;
    if (!viewCondition) {
      return;
    }
    if (this.viewConditions[condition]) {
      this.viewConditions[condition].push(viewCondition);
    } else {
      this.viewConditions[condition] = [viewCondition];
    }
  }

  decrement(condition: string, viewCondition: Matcher): void {
    this.conditions[condition]--;
    if (!this.viewConditions[condition]) {
      return;
    }
    this.viewConditions[condition] =
        this.viewConditions[condition].filter((item) => item !== viewCondition);
    if (this.viewConditions[condition].length === 0) {
      delete this.viewConditions[condition];
    }
  }

  buildViewConditionMatcher(viewConditionId: string|null): Matcher {
    const matcherBuilder = vivliostyle.selectors.MatcherBuilder.instance;
    let matcher = null;
    if (viewConditionId) {
      goog.asserts.assert(this.currentElementOffset);
      matcher = matcherBuilder.buildViewConditionMatcher(
          this.currentElementOffset, viewConditionId);
    }
    const dependentConditionMatchers =
        this.dependentConditions
            .map((conditionId) => {
              const conditions = this.viewConditions[conditionId];
              if (conditions && conditions.length > 0) {
                return conditions.length === 1 ?
                    conditions[0] :
                    matcherBuilder.buildAnyMatcher([].concat(conditions));
              } else {
                return null;
              }
            })
            .filter((item) => item);
    if (dependentConditionMatchers.length <= 0) {
      return matcher;
    }
    if (matcher === null) {
      return dependentConditionMatchers.length === 1 ?
          dependentConditionMatchers[0] :
          matcherBuilder.buildAllMatcher(dependentConditionMatchers);
    }
    return matcherBuilder.buildAllMatcher(
        [matcher].concat(dependentConditionMatchers));
  }

  applyAction(table: ActionTable, key: string): void {
    const action = table[key];
    action && action.apply(this);
  }

  pushRule(classes: string[], pageType: string|null, baseStyle: ElementStyle):
      void {
    this.currentElement = null;
    this.currentElementOffset = null;
    this.currentStyle = baseStyle;
    this.currentNamespace = '';
    this.currentLocalName = '';
    this.currentId = '';
    this.currentXmlId = '';
    this.currentClassNames = classes;
    this.currentNSTag = '';
    this.currentEpubTypes = EMPTY;
    this.currentPageType = pageType;
    this.applyActions();
  }

  defineCounter(counterName: string, value: number) {
    if (this.counters[counterName]) {
      this.counters[counterName].push(value);
    } else {
      this.counters[counterName] = [value];
    }
    let scoping = this.counterScoping[this.counterScoping.length - 1];
    if (!scoping) {
      scoping = {};
      this.counterScoping[this.counterScoping.length - 1] = scoping;
    }
    scoping[counterName] = true;
  }

  pushCounters(props: ElementStyle): void {
    let displayVal = css.ident.inline;
    const display = props['display'];
    if (display) {
      displayVal = display.evaluate(this.context);
    }
    let resetMap = null;
    let incrementMap = null;
    let setMap = null;
    const reset = props['counter-reset'];
    if (reset) {
      const resetVal = reset.evaluate(this.context);
      if (resetVal) {
        resetMap = cssprop.toCounters(resetVal, true);
      }
    }
    const set = props['counter-set'];
    if (set) {
      const setVal = set.evaluate(this.context);
      if (setVal) {
        setMap = cssprop.toCounters(setVal, false);
      }
    }
    const increment = props['counter-increment'];
    if (increment) {
      const incrementVal = increment.evaluate(this.context);
      if (incrementVal) {
        incrementMap = cssprop.toCounters(incrementVal, false);
      }
    }
    if ((this.currentLocalName == 'ol' || this.currentLocalName == 'ul') &&
        this.currentNamespace == adapt.base.NS.XHTML) {
      if (!resetMap) {
        resetMap = {};
      }
      resetMap['ua-list-item'] = 0;
    }
    if (displayVal === css.ident.list_item) {
      if (!incrementMap) {
        incrementMap = {};
      }
      incrementMap['ua-list-item'] = 1;
    }
    if (resetMap) {
      for (const resetCounterName in resetMap) {
        this.defineCounter(resetCounterName, resetMap[resetCounterName]);
      }
    }
    if (setMap) {
      for (const setCounterName in setMap) {
        if (!this.counters[setCounterName]) {
          this.defineCounter(setCounterName, setMap[setCounterName]);
        } else {
          let counterValues = this.counters[setCounterName];
          counterValues[counterValues.length - 1] = setMap[setCounterName];
        }
      }
    }
    if (incrementMap) {
      for (const incrementCounterName in incrementMap) {
        if (!this.counters[incrementCounterName]) {
          this.defineCounter(incrementCounterName, 0);
        }
        let counterValues = this.counters[incrementCounterName];
        counterValues[counterValues.length - 1] +=
            incrementMap[incrementCounterName];
      }
    }
    if (displayVal === css.ident.list_item) {
      const listItemCounts = this.counters['ua-list-item'];
      const listItemCount = listItemCounts[listItemCounts.length - 1];
      props['ua-list-item-count'] =
          new CascadeValue(new css.Num(listItemCount), 0);
    }
    this.counterScoping.push(null);
  }

  popCounters(): void {
    const scoping = this.counterScoping.pop();
    if (scoping) {
      for (const counterName in scoping) {
        const arr = this.counters[counterName];
        if (arr) {
          if (arr.length == 1) {
            delete this.counters[counterName];
          } else {
            arr.pop();
          }
        }
      }
    }
  }

  processPseudoelementProps(pseudoprops: ElementStyle, element: Element): void {
    this.pushCounters(pseudoprops);
    if (pseudoprops['content']) {
      pseudoprops['content'] = pseudoprops['content'].filterValue(
          new ContentPropVisitor(this, element, this.counterResolver));
    }
    this.popCounters();
  }

  pushElement(element: Element, baseStyle: ElementStyle, elementOffset: number):
      void {
    if (goog.DEBUG) {
      this.elementStack.push(element);
    }

    // do not apply page rules
    this.currentPageType = null;
    this.currentElement = element;
    this.currentElementOffset = elementOffset;
    this.currentStyle = baseStyle;
    this.currentNamespace = element.namespaceURI;
    this.currentLocalName = element.localName;
    const prefix = this.code.nsPrefix[this.currentNamespace];
    if (prefix) {
      this.currentNSTag = prefix + this.currentLocalName;
    } else {
      this.currentNSTag = '';
    }
    this.currentId = element.getAttribute('id');
    this.currentXmlId = element.getAttributeNS(adapt.base.NS.XML, 'id');
    const classes = element.getAttribute('class');
    if (classes) {
      this.currentClassNames = classes.split(/\s+/);
    } else {
      this.currentClassNames = EMPTY;
    }
    const types = element.getAttributeNS(adapt.base.NS.epub, 'type');
    if (types) {
      this.currentEpubTypes = types.split(/\s+/);
    } else {
      this.currentEpubTypes = EMPTY;
    }
    if (this.currentLocalName == 'style' &&
        this.currentNamespace == adapt.base.NS.FB2) {
      // special case
      const className = element.getAttribute('name') || '';
      this.currentClassNames = [className];
    }
    const lang = adapt.base.getLangAttribute(element);
    if (lang) {
      this.stack[this.stack.length - 1].push(new RestoreLangItem(this.lang));
      this.lang = lang.toLowerCase();
    }
    const isRoot = this.isRoot;
    const siblingOrderStack = this.siblingOrderStack;
    this.currentSiblingOrder =
        ++siblingOrderStack[siblingOrderStack.length - 1];
    siblingOrderStack.push(0);
    const siblingTypeCountsStack = this.siblingTypeCountsStack;
    const currentSiblingTypeCounts = this.currentSiblingTypeCounts =
        siblingTypeCountsStack[siblingTypeCountsStack.length - 1];
    let currentNamespaceTypeCounts =
        currentSiblingTypeCounts[this.currentNamespace];
    if (!currentNamespaceTypeCounts) {
      currentNamespaceTypeCounts =
          currentSiblingTypeCounts[this.currentNamespace] = {};
    }
    currentNamespaceTypeCounts[this.currentLocalName] =
        (currentNamespaceTypeCounts[this.currentLocalName] || 0) + 1;
    siblingTypeCountsStack.push({});
    const followingSiblingOrderStack = this.followingSiblingOrderStack;
    if (followingSiblingOrderStack[followingSiblingOrderStack.length - 1] !==
        null) {
      this.currentFollowingSiblingOrder =
          --followingSiblingOrderStack[followingSiblingOrderStack.length - 1];
    } else {
      this.currentFollowingSiblingOrder = null;
    }
    followingSiblingOrderStack.push(null);
    const followingSiblingTypeCountsStack =
        this.followingSiblingTypeCountsStack;
    const currentFollowingSiblingTypeCounts = this.currentFollowingSiblingTypeCounts =
        followingSiblingTypeCountsStack[followingSiblingTypeCountsStack.length - 1];
    if (currentFollowingSiblingTypeCounts &&
        currentFollowingSiblingTypeCounts[this.currentNamespace]) {
      currentFollowingSiblingTypeCounts[this.currentNamespace][this.currentLocalName]--;
    }
    followingSiblingTypeCountsStack.push({});
    this.applyActions();
    this.applyAttrFilter(element);
    const quotesCasc = baseStyle['quotes'];
    let itemToPushLast = null;
    if (quotesCasc) {
      const quotesVal = quotesCasc.evaluate(this.context);
      if (quotesVal) {
        itemToPushLast = new QuotesScopeItem(this.quotes);
        if (quotesVal === css.ident.none) {
          this.quotes = [new css.Str(''), new css.Str('')];
        } else {
          if (quotesVal instanceof css.SpaceList) {
            this.quotes = ((quotesVal as css.SpaceList).values as css.Str[]);
          }
        }
      }
    }
    this.pushCounters(this.currentStyle);
    const id = this.currentId || this.currentXmlId ||
        element.getAttribute('name') || '';
    if (isRoot || id) {
      const counters: {[key: string]: number[]} = {};
      Object.keys(this.counters).forEach(function(name) {
        counters[name] = Array.from(this.counters[name]);
      }, this);
      this.counterListener.countersOfId(id, counters);
    }
    const pseudos = getStyleMap(this.currentStyle, '_pseudos');
    if (pseudos) {
      let before = true;
      for (const pseudoName of pseudoNames) {
        if (!pseudoName) {
          // content
          before = false;
        }
        const pseudoProps = pseudos[pseudoName];
        if (pseudoProps) {
          if (before) {
            this.processPseudoelementProps(pseudoProps, element);
          } else {
            this.stack[this.stack.length - 2].push(
                new AfterPseudoelementItem(pseudoProps, element));
          }
        }
      }
    }
    if (itemToPushLast) {
      this.stack[this.stack.length - 2].push(itemToPushLast);
    }
  }

  private applyAttrFilterInner(visitor, elementStyle): void {
    for (const propName in elementStyle) {
      if (isPropName(propName)) {
        elementStyle[propName] = elementStyle[propName].filterValue(visitor);
      }
    }
  }

  private applyAttrFilter(element): void {
    const visitor = new AttrValueFilterVisitor(element);
    const currentStyle = this.currentStyle;
    const pseudoMap = getStyleMap(currentStyle, '_pseudos');
    for (const pseudoName in pseudoMap) {
      this.applyAttrFilterInner(visitor, pseudoMap[pseudoName]);
    }
    this.applyAttrFilterInner(visitor, currentStyle);
  }

  private applyActions(): void {
    let i;
    for (i = 0; i < this.currentClassNames.length; i++) {
      this.applyAction(this.code.classes, this.currentClassNames[i]);
    }
    for (i = 0; i < this.currentEpubTypes.length; i++) {
      this.applyAction(this.code.epubtypes, this.currentEpubTypes[i]);
    }
    this.applyAction(this.code.ids, this.currentId);
    this.applyAction(this.code.tags, this.currentLocalName);
    if (this.currentLocalName != '') {
      // Universal selector does not apply to page-master-related rules.
      this.applyAction(this.code.tags, '*');
    }
    this.applyAction(this.code.nstags, this.currentNSTag);

    // Apply page rules only when currentPageType is not null
    if (this.currentPageType !== null) {
      this.applyAction(this.code.pagetypes, this.currentPageType);

      // We represent page rules without selectors by *, though it is illegal in
      // CSS
      this.applyAction(this.code.pagetypes, '*');
    }
    this.currentElement = null;
    this.currentDoc = null;
    this.stack.push([]);
    for (let depth = 1; depth >= -1; --depth) {
      const list = this.stack[this.stack.length - depth - 2];
      i = 0;
      while (i < list.length) {
        if (list[i].push(this, depth)) {
          // done
          list.splice(i, 1);
        } else {
          i++;
        }
      }
    }
    this.isFirst = true;
    this.isRoot = false;
  }

  private pop(): void {
    for (let depth = 1; depth >= -1; --depth) {
      const list = this.stack[this.stack.length - depth - 2];
      let i = 0;
      while (i < list.length) {
        if (list[i].pop(this, depth)) {
          // done
          list.splice(i, 1);
        } else {
          i++;
        }
      }
    }
    this.stack.pop();
    this.isFirst = false;
  }

  popRule(): void {
    this.pop();
  }

  popElement(element: Element): void {
    if (goog.DEBUG) {
      const e = this.elementStack.pop();
      if (e !== element) {
        throw new Error('Invalid call to popElement');
      }
    }
    this.siblingOrderStack.pop();
    this.siblingTypeCountsStack.pop();
    this.followingSiblingOrderStack.pop();
    this.followingSiblingTypeCountsStack.pop();
    this.pop();
    this.popCounters();
  }
}

export const EMPTY = [];

/**
 * Pseudoelement names in the order they should be processed, empty string is
 * the place where the element's DOM children are processed.
 */
export const pseudoNames = [
  'before', 'transclusion-before', 'footnote-call', 'footnote-marker', 'inner',
  'first-letter', 'first-line', '',
  /* content */
  'transclusion-after', 'after'
];

/**
 * @enum {number}
 */
export enum ParseState {
  TOP,
  SELECTOR,
  RULE
}

/**
 * Cascade for base User Agent stylesheet.
 */
export const uaBaseCascade: Cascade = null;

//------------- parsing ------------
export class CascadeParserHandler extends
    adapt.cssparse.SlaveParserHandler implements cssvalid.PropertyReceiver {
  chain: ChainedAction[] = null;
  specificity: number = 0;
  elementStyle: ElementStyle = null;
  conditionCount: number = 0;
  pseudoelement: string|null = null;
  footnoteContent: boolean = false;
  cascade: any;
  state: ParseState;
  viewConditionId: string|null = null;
  insideSelectorRule: any;

  constructor(
      scope: expr.LexicalScope, owner: cssparse.DispatchParserHandler,
      public readonly condition: expr.Val, parent: CascadeParserHandler,
      public readonly regionId: string|null,
      public readonly validatorSet: cssvalid.ValidatorSet, topLevel: boolean) {
    cssparse.SlaveParserHandler.call(this, scope, owner, topLevel);
    this.cascade = parent ?
        parent.cascade :
        uaBaseCascade ? uaBaseCascade.clone() : new Cascade();
    this.state = ParseState.TOP;
  }

  protected insertNonPrimary(action: CascadeAction): void {
    this.cascade.insertInTable(this.cascade.tags, '*', action);
  }

  processChain(action: CascadeAction): void {
    const chained = chainActions(this.chain, action);
    if (chained !== action && chained.makePrimary(this.cascade)) {
      return;
    }
    this.insertNonPrimary(chained);
  }

  isInsideSelectorRule(mnemonics: string): boolean {
    if (this.state != ParseState.TOP) {
      this.reportAndSkip(mnemonics);
      return true;
    }
    return false;
  }

  /**
   * @override
   */
  tagSelector(ns, name) {
    if (!name && !ns) {
      return;
    }
    this.specificity += 1;
    if (name && ns) {
      this.chain.push(new CheckNSTagAction(ns, name.toLowerCase()));
    } else {
      if (name) {
        this.chain.push(new CheckLocalNameAction(name.toLowerCase()));
      } else {
        this.chain.push(new CheckNamespaceAction((ns as string)));
      }
    }
  }

  /**
   * @override
   */
  classSelector(name) {
    if (this.pseudoelement) {
      logging.logger.warn(`::${this.pseudoelement}`, `followed by .${name}`);
      this.chain.push(new CheckConditionAction(''));

      // always fails
      return;
    }
    this.specificity += 256;
    this.chain.push(new CheckClassAction(name));
  }

  /**
   * @override
   */
  pseudoclassSelector(name, params) {
    if (this.pseudoelement) {
      logging.logger.warn(`::${this.pseudoelement}`, `followed by :${name}`);
      this.chain.push(new CheckConditionAction(''));

      // always fails
      return;
    }
    switch (name.toLowerCase()) {
      case 'enabled':
        this.chain.push(new IsEnabledAction());
        break;
      case 'disabled':
        this.chain.push(new IsDisabledAction());
        break;
      case 'checked':
        this.chain.push(new IsCheckedAction());
        break;
      case 'root':
        this.chain.push(new IsRootAction());
        break;
      case 'link':
        this.chain.push(new CheckLocalNameAction('a'));
        this.chain.push(new CheckAttributePresentAction('', 'href'));
        break;
      case '-adapt-href-epub-type':
      case 'href-epub-type':
        if (params && params.length == 1 && typeof params[0] == 'string') {
          const value = (params[0] as string);
          const patt =
              new RegExp(`(^|s)${adapt.base.escapeRegExp(value)}(\$|s)`);
          this.chain.push(new CheckTargetEpubTypeAction(patt));
        } else {
          this.chain.push(new CheckConditionAction(''));
        }

        // always fails
        break;
      case '-adapt-footnote-content':
      case 'footnote-content':

        // content inside the footnote
        this.footnoteContent = true;
        break;
      case 'visited':
      case 'active':
      case 'hover':
      case 'focus':
        this.chain.push(new CheckConditionAction(''));

        // always fails
        break;
      case 'lang':
        if (params && params.length == 1 && typeof params[0] == 'string') {
          const langValue = (params[0] as string);
          this.chain.push(new CheckLangAction(new RegExp(
              `^${adapt.base.escapeRegExp(langValue.toLowerCase())}(\$|-)`)));
        } else {
          this.chain.push(new CheckConditionAction(''));
        }

        // always fais
        break;
      case 'nth-child':
      case 'nth-last-child':
      case 'nth-of-type':
      case 'nth-last-of-type':
        const ActionClass = nthSelectorActionClasses[name.toLowerCase()];
        if (params && params.length == 2) {
          this.chain.push(
              new ActionClass((params[0] as number), (params[1] as number)));
        } else {
          this.chain.push(new CheckConditionAction(''));
        }

        // always fails
        break;
      case 'first-child':
        this.chain.push(new IsFirstAction());
        break;
      case 'last-child':
        this.chain.push(new IsNthLastSiblingAction(0, 1));
        break;
      case 'first-of-type':
        this.chain.push(new IsNthSiblingOfTypeAction(0, 1));
        break;
      case 'last-of-type':
        this.chain.push(new IsNthLastSiblingOfTypeAction(0, 1));
        break;
      case 'only-child':
        this.chain.push(new IsFirstAction());
        this.chain.push(new IsNthLastSiblingAction(0, 1));
        break;
      case 'only-of-type':
        this.chain.push(new IsNthSiblingOfTypeAction(0, 1));
        this.chain.push(new IsNthLastSiblingOfTypeAction(0, 1));
        break;
      case 'empty':
        this.chain.push(new IsEmptyAction());
        break;
      case 'before':
      case 'after':
      case 'first-line':
      case 'first-letter':
        this.pseudoelementSelector(name, params);
        return;
      default:
        logging.logger.warn(`unknown pseudo-class selector: ${name}`);
        this.chain.push(new CheckConditionAction(''));

        // always fails
        break;
    }
    this.specificity += 256;
  }

  /**
   * @override
   */
  pseudoelementSelector(name, params) {
    switch (name) {
      case 'before':
      case 'after':
      case 'first-line':
      case 'first-letter':
      case 'footnote-call':
      case 'footnote-marker':
      case 'inner':
      case 'after-if-continues':
        if (!this.pseudoelement) {
          this.pseudoelement = name;
        } else {
          logging.logger.warn(
              `Double pseudoelement ::${this.pseudoelement}::${name}`);
          this.chain.push(new CheckConditionAction(''));
        }

        // always fails
        break;
      case 'first-n-lines':
        if (params && params.length == 1 && typeof params[0] == 'number') {
          const n = Math.round(params[0]);
          if (n > 0 && n == params[0]) {
            if (!this.pseudoelement) {
              this.pseudoelement = `first-${n}-lines`;
            } else {
              logging.logger.warn(
                  `Double pseudoelement ::${this.pseudoelement}::${name}`);
              this.chain.push(new CheckConditionAction(''));
            }

            // always fails
            break;
          }
        }
      case 'nth-fragment':
        if (params && params.length == 2) {
          this.viewConditionId = `NFS_${params[0]}_${params[1]}`;
        } else {
          this.chain.push(new CheckConditionAction(''));
        }

        // always fails
        break;
      default:
        logging.logger.warn(`Unrecognized pseudoelement: ::${name}`);
        this.chain.push(new CheckConditionAction(''));

        // always fails
        break;
    }
    this.specificity += 1;
  }

  /**
   * @override
   */
  idSelector(id) {
    this.specificity += 65536;
    this.chain.push(new CheckIdAction(id));
  }

  /**
   * @override
   */
  attributeSelector(ns, name, op, value) {
    this.specificity += 256;
    name = name.toLowerCase();
    value = value || '';
    let action;
    switch (op) {
      case adapt.csstok.TokenType.EOF:
        action = new CheckAttributePresentAction(ns, name);
        break;
      case adapt.csstok.TokenType.EQ:
        action = new CheckAttributeEqAction(ns, name, value);
        break;
      case adapt.csstok.TokenType.TILDE_EQ:

        // always fails
        if (!value || value.match(/\s/)) {
          action = new CheckConditionAction('');
        } else {
          action = new CheckAttributeRegExpAction(
              ns, name,
              new RegExp(`(^|\\s)${adapt.base.escapeRegExp(value)}(\$|\\s)`));
        }
        break;
      case adapt.csstok.TokenType.BAR_EQ:
        action = new CheckAttributeRegExpAction(
            ns, name, new RegExp(`^${adapt.base.escapeRegExp(value)}(\$|-)`));
        break;
      case adapt.csstok.TokenType.HAT_EQ:

        // always fails
        if (!value) {
          action = new CheckConditionAction('');
        } else {
          action = new CheckAttributeRegExpAction(
              ns, name, new RegExp(`^${adapt.base.escapeRegExp(value)}`));
        }
        break;
      case adapt.csstok.TokenType.DOLLAR_EQ:

        // always fails
        if (!value) {
          action = new CheckConditionAction('');
        } else {
          action = new CheckAttributeRegExpAction(
              ns, name, new RegExp(`${adapt.base.escapeRegExp(value)}\$`));
        }
        break;
      case adapt.csstok.TokenType.STAR_EQ:

        // always fails
        if (!value) {
          action = new CheckConditionAction('');
        } else {
          action = new CheckAttributeRegExpAction(
              ns, name, new RegExp(adapt.base.escapeRegExp(value)));
        }
        break;
      case adapt.csstok.TokenType.COL_COL:
        if (value == 'supported') {
          action = new CheckNamespaceSupportedAction(ns, name);
        } else {
          logging.logger.warn('Unsupported :: attr selector op:', value);
          action = new CheckConditionAction('');
        }

        // always fails
        break;
      default:
        logging.logger.warn('Unsupported attr selector:', op);
        action = new CheckConditionAction('');
    }

    // always fails
    this.chain.push(action);
  }

  /**
   * @override
   */
  descendantSelector() {
    const condition = `d${conditionCount++}`;
    this.processChain(new ConditionItemAction(
        new DescendantConditionItem(condition, this.viewConditionId, null)));
    this.chain = [new CheckConditionAction(condition)];
    this.viewConditionId = null;
  }

  /**
   * @override
   */
  childSelector() {
    const condition = `c${conditionCount++}`;
    this.processChain(new ConditionItemAction(
        new ChildConditionItem(condition, this.viewConditionId, null)));
    this.chain = [new CheckConditionAction(condition)];
    this.viewConditionId = null;
  }

  /**
   * @override
   */
  adjacentSiblingSelector() {
    const condition = `a${conditionCount++}`;
    this.processChain(new ConditionItemAction(new AdjacentSiblingConditionItem(
        condition, this.viewConditionId, null)));
    this.chain = [new CheckConditionAction(condition)];
    this.viewConditionId = null;
  }

  /**
   * @override
   */
  followingSiblingSelector() {
    const condition = `f${conditionCount++}`;
    this.processChain(new ConditionItemAction(new FollowingSiblingConditionItem(
        condition, this.viewConditionId, null)));
    this.chain = [new CheckConditionAction(condition)];
    this.viewConditionId = null;
  }

  /**
   * @override
   */
  nextSelector() {
    this.finishChain();
    this.pseudoelement = null;
    this.footnoteContent = false;
    this.specificity = 0;
    this.chain = [];
  }

  /**
   * @override
   */
  startSelectorRule() {
    if (this.isInsideSelectorRule('E_CSS_UNEXPECTED_SELECTOR')) {
      return;
    }
    this.state = ParseState.SELECTOR;
    this.elementStyle = ({} as ElementStyle);
    this.pseudoelement = null;
    this.specificity = 0;
    this.footnoteContent = false;
    this.chain = [];
  }

  /**
   * @override
   */
  error(message, token) {
    cssparse.SlaveParserHandler.prototype.error.call(this, message, token);
    if (this.state == ParseState.SELECTOR) {
      this.state = ParseState.TOP;
    }
  }

  /**
   * @override
   */
  startStylesheet(flavor) {
    cssparse.SlaveParserHandler.prototype.startStylesheet.call(this, flavor);
    this.state = ParseState.TOP;
  }

  /**
   * @override
   */
  startRuleBody() {
    this.finishChain();
    cssparse.SlaveParserHandler.prototype.startRuleBody.call(this);
    if (this.state == ParseState.SELECTOR) {
      this.state = ParseState.TOP;
    }
  }

  /**
   * @override
   */
  endRule() {
    cssparse.SlaveParserHandler.prototype.endRule.call(this);
    this.insideSelectorRule = ParseState.TOP;
  }

  finishChain(): void {
    if (this.chain) {
      const specificity: number = this.specificity + this.cascade.nextOrder();
      this.processChain(this.makeApplyRuleAction(specificity));
      this.chain = null;
      this.pseudoelement = null;
      this.viewConditionId = null;
      this.footnoteContent = false;
      this.specificity = 0;
    }
  }

  protected makeApplyRuleAction(specificity: number): ApplyRuleAction {
    let regionId = this.regionId;
    if (this.footnoteContent) {
      if (regionId) {
        regionId = 'xxx-bogus-xxx';
      } else {
        regionId = 'footnote';
      }
    }
    return new ApplyRuleAction(
        this.elementStyle, specificity, this.pseudoelement, regionId,
        this.viewConditionId);
  }

  special(name: string, value: css.Val) {
    let val;
    if (!this.condition) {
      val = new CascadeValue(value, 0);
    } else {
      val = new ConditionalCascadeValue(value, 0, this.condition);
    }
    const arr = getMutableSpecial(this.elementStyle, name);
    arr.push(val);
  }

  /**
   * @override
   */
  property(name, value, important) {
    this.validatorSet.validatePropertyAndHandleShorthand(
        name, value, important, this);
  }

  /**
   * @override
   */
  invalidPropertyValue(name, value) {
    this.report(`E_INVALID_PROPERTY_VALUE ${name}: ${value.toString()}`);
  }

  /**
   * @override
   */
  unknownProperty(name, value) {
    this.report(`E_INVALID_PROPERTY ${name}: ${value.toString()}`);
  }

  /**
   * @override
   */
  simpleProperty(name, value, important) {
    if (name == 'display' &&
        (value === css.ident.oeb_page_head ||
         value === css.ident.oeb_page_foot)) {
      this.simpleProperty(
          'flow-options',
          new css.SpaceList([css.ident.exclusive, css.ident._static]),
          important);
      this.simpleProperty('flow-into', value, important);
      value = css.ident.block;
    }
    const hooks = plugin.getHooksForName('SIMPLE_PROPERTY');
    hooks.forEach((hook) => {
      const original = {'name': name, 'value': value, 'important': important};
      const converted = hook(original);
      name = converted['name'];
      value = converted['value'];
      important = converted['important'];
    });
    const specificity =
        important ? this.getImportantSpecificity() : this.getBaseSpecificity();
    const cascval = this.condition ?
        new ConditionalCascadeValue(value, specificity, this.condition) :
        new CascadeValue(value, specificity);
    setProp(this.elementStyle, name, cascval);
  }

  finish(): Cascade {
    return this.cascade;
  }

  /**
   * @override
   */
  startFuncWithSelector(funcName) {
    switch (funcName) {
      case 'not':
        const notParserHandler = new NotParameterParserHandler(this);
        notParserHandler.startSelectorRule();
        this.owner.pushHandler(notParserHandler);
        break;
      default:

        // TODO
        break;
    }
  }
}
goog.inherits(CascadeParserHandler, cssparse.SlaveParserHandler);

export const nthSelectorActionClasses:
    {[key: string]: (p1: number, p2: number) => any} = {
      'nth-child': IsNthSiblingAction,
      'nth-of-type': IsNthSiblingOfTypeAction,
      'nth-last-child': IsNthLastSiblingAction,
      'nth-last-of-type': IsNthLastSiblingOfTypeAction
    };

export const conditionCount: number = 0;

export class NotParameterParserHandler extends
    adapt.csscasc.CascadeParserHandler {
  parentChain: any;

  constructor(public readonly parent: CascadeParserHandler) {
    CascadeParserHandler.call(
        this, parent.scope, parent.owner, parent.condition, parent,
        parent.regionId, parent.validatorSet, false);
    this.parentChain = parent.chain;
  }

  /**
   * @override
   */
  startFuncWithSelector(funcName) {
    if (funcName == 'not') {
      this.reportAndSkip('E_CSS_UNEXPECTED_NOT');
    }
  }

  /**
   * @override
   */
  startRuleBody() {
    this.reportAndSkip('E_CSS_UNEXPECTED_RULE_BODY');
  }

  /**
   * @override
   */
  nextSelector() {
    this.reportAndSkip('E_CSS_UNEXPECTED_NEXT_SELECTOR');
  }

  /**
   * @override
   */
  endFuncWithSelector() {
    if (this.chain && this.chain.length > 0) {
      this.parentChain.push(new NegateActionsSet(this.chain));
    }
    this.parent.specificity += this.specificity;
    this.owner.popHandler();
  }

  /**
   * @override
   */
  error(mnemonics, token) {
    CascadeParserHandler.prototype.error.call(this, mnemonics, token);
    this.owner.popHandler();
  }
}
goog.inherits(NotParameterParserHandler, CascadeParserHandler);

/**
 * @override
 */
export class DefineParserHandler extends adapt.cssparse.SlaveParserHandler {
  constructor(scope: expr.LexicalScope, owner: cssparse.DispatchParserHandler) {
    cssparse.SlaveParserHandler.call(this, scope, owner, false);
  }

  /**
   * @override
   */
  property(propName, value, important) {
    if (this.scope.values[propName]) {
      this.error(`E_CSS_NAME_REDEFINED ${propName}`, this.getCurrentToken());
    } else {
      const unit = propName.match(/height|^(top|bottom)$/) ? 'vh' : 'vw';
      const dim = new expr.Numeric(this.scope, 100, unit);
      this.scope.defineName(propName, value.toExpr(this.scope, dim));
    }
  }
}
goog.inherits(DefineParserHandler, cssparse.SlaveParserHandler);

export class PropSetParserHandler extends
    adapt.cssparse.SlaveParserHandler implements cssvalid.PropertyReceiver {
  constructor(
      scope: expr.LexicalScope, owner: cssparse.DispatchParserHandler,
      public readonly condition: expr.Val,
      public readonly elementStyle: ElementStyle,
      public readonly validatorSet: cssvalid.ValidatorSet) {
    cssparse.SlaveParserHandler.call(this, scope, owner, false);
  }

  /**
   * @override
   */
  property(name, value, important) {
    if (important) {
      logging.logger.warn('E_IMPORTANT_NOT_ALLOWED');
    } else {
      this.validatorSet.validatePropertyAndHandleShorthand(
          name, value, important, this);
    }
  }

  /**
   * @override
   */
  invalidPropertyValue(name, value) {
    logging.logger.warn(
        'E_INVALID_PROPERTY_VALUE', `${name}:`, value.toString());
  }

  /**
   * @override
   */
  unknownProperty(name, value) {
    logging.logger.warn('E_INVALID_PROPERTY', `${name}:`, value.toString());
  }

  /**
   * @override
   */
  simpleProperty(name, value, important) {
    let specificity =
        important ? this.getImportantSpecificity() : this.getBaseSpecificity();
    specificity += this.order;
    this.order += ORDER_INCREMENT;
    const av = this.condition ?
        new ConditionalCascadeValue(value, specificity, this.condition) :
        new CascadeValue(value, specificity);
    setProp(this.elementStyle, name, av);
  }
}
goog.inherits(PropSetParserHandler, cssparse.SlaveParserHandler);

export class PropertyParserHandler extends
    adapt.cssparse.ErrorHandler implements cssvalid.PropertyReceiver {
  elementStyle: any = ({} as ElementStyle);
  order: number = 0;

  constructor(
      scope: expr.LexicalScope,
      public readonly validatorSet: cssvalid.ValidatorSet) {
    cssparse.ErrorHandler.call(this, scope);
  }

  /**
   * @override
   */
  property(name, value, important) {
    this.validatorSet.validatePropertyAndHandleShorthand(
        name, value, important, this);
  }

  /**
   * @override
   */
  invalidPropertyValue(name, value) {
    logging.logger.warn(
        'E_INVALID_PROPERTY_VALUE', `${name}:`, value.toString());
  }

  /**
   * @override
   */
  unknownProperty(name, value) {
    logging.logger.warn('E_INVALID_PROPERTY', `${name}:`, value.toString());
  }

  /**
   * @override
   */
  simpleProperty(name, value, important) {
    let specificity = important ? cssparse.SPECIFICITY_STYLE_IMPORTANT :
                                  cssparse.SPECIFICITY_STYLE;
    specificity += this.order;
    this.order += ORDER_INCREMENT;
    const cascval = new CascadeValue(value, specificity);
    setProp(this.elementStyle, name, cascval);
  }
}
goog.inherits(PropertyParserHandler, cssparse.ErrorHandler);

export const parseStyleAttribute =
    (scope: expr.LexicalScope, validatorSet: cssvalid.ValidatorSet,
     baseURL: string, styleAttrValue: string): ElementStyle => {
      const handler = new PropertyParserHandler(scope, validatorSet);
      const tokenizer = new adapt.csstok.Tokenizer(styleAttrValue, handler);
      try {
        cssparse.parseStyleAttribute(tokenizer, handler, baseURL);
      } catch (err) {
        logging.logger.warn(err, 'Style attribute parse error:');
      }
      return handler.elementStyle;
    };

export const isVertical =
    (cascaded: {[key: string]: CascadeValue}, context: expr.Context,
     vertical: boolean): boolean => {
      const writingModeCasc = cascaded['writing-mode'];
      if (writingModeCasc) {
        const writingMode = writingModeCasc.evaluate(context, 'writing-mode');
        if (writingMode && writingMode !== css.ident.inherit) {
          return writingMode === css.ident.vertical_rl;
        }
      }
      return vertical;
    };

export const isRtl =
    (cascaded: {[key: string]: CascadeValue}, context: expr.Context,
     rtl: boolean): boolean => {
      const directionCasc = cascaded['direction'];
      if (directionCasc) {
        const direction = directionCasc.evaluate(context, 'direction');
        if (direction && direction !== css.ident.inherit) {
          return direction === css.ident.rtl;
        }
      }
      return rtl;
    };

export const flattenCascadedStyle =
    (style: ElementStyle, context: expr.Context, regionIds: string[],
     isFootnote: boolean,
     nodeContext: NodeContext): {[key: string]: CascadeValue} => {
      const cascMap = ({} as {[key: string]: CascadeValue});
      for (const n in style) {
        if (isPropName(n)) {
          cascMap[n] = getProp(style, n);
        }
      }
      vivliostyle.selectors.mergeViewConditionalStyles(cascMap, context, style);
      forEachStylesInRegion(
          style, regionIds, isFootnote, (regionId, regionStyle) => {
            mergeStyle(cascMap, regionStyle, context);
            vivliostyle.selectors.mergeViewConditionalStyles(
                cascMap, context, regionStyle);
          });
      return cascMap;
    };

export const forEachStylesInRegion =
    (style: ElementStyle, regionIds: string[], isFootnote: boolean,
     callback: (p1: string, p2: ElementStyle) => any) => {
      const regions = getStyleMap(style, '_regions');
      if ((regionIds || isFootnote) && regions) {
        if (isFootnote) {
          const footnoteRegion = ['footnote'];
          if (!regionIds) {
            regionIds = footnoteRegion;
          } else {
            regionIds = regionIds.concat(footnoteRegion);
          }
        }
        for (const regionId of regionIds) {
          const regionStyle = regions[regionId];
          if (regionStyle) {
            callback(regionId, regionStyle);
          }
        }
      }
    };

export const mergeStyle =
    (to: {[key: string]: CascadeValue}, from: ElementStyle,
     context: expr.Context) => {
      for (const property in from) {
        if (isPropName(property)) {
          const newVal = getProp(from, property);
          const oldVal = to[property];
          to[property] =
              cascadeValues(context, oldVal, (newVal as CascadeValue));
        }
      }
    };

/**
 * Convert logical properties to physical ones, taking specificity into account.
 * @param src Source properties map
 * @param dest Destination map
 * @param transform If supplied, property values are transformed by this
 *     function before inserted into the destination map. The first parameter is
 *     the property name and the second one is the property value.
 * @template T
 */
export const convertToPhysical =
    (src: {[key: string]: CascadeValue}, dest: {[key: string]: T},
     vertical: boolean, rtl: boolean,
     transform: (p1: string, p2: CascadeValue) => T) => {
      const couplingMap = vertical ?
          rtl ? couplingMapVertRtl : couplingMapVert :
          rtl ? couplingMapHorRtl : couplingMapHor;
      for (const propName in src) {
        if (src.hasOwnProperty(propName)) {
          const cascVal = src[propName];
          if (!cascVal) {
            continue;
          }
          const coupledName = couplingMap[propName];
          let targetName;
          if (coupledName) {
            const coupledCascVal = src[coupledName];
            if (coupledCascVal && coupledCascVal.priority > cascVal.priority) {
              continue;
            }
            targetName = geomNames[coupledName] ? coupledName : propName;
          } else {
            targetName = propName;
          }
          dest[targetName] = transform(propName, cascVal);
        }
      }
    };
