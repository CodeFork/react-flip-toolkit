import * as Rematrix from "rematrix"
import { getSpringConfig } from "../../springSettings"
import {
  toArray,
  isFunction,
  isNumber,
  getDuplicateValsAsStrings,
  assign
} from "../../utilities"
import * as constants from "../../constants"
import filterFlipDescendants from "./filterFlipDescendants"
import initiateAnimations from "./initiateAnimations"

// 3d transforms were causing weird issues in chrome,
// especially when opacity was also being tweened,
// so convert to a 2d matrix
export const convertMatrix3dArrayTo2dArray = matrix =>
  [0, 1, 4, 5, 12, 13].map(index => matrix[index])

export const convertMatrix2dArrayToString = matrix =>
  `matrix(${matrix.join(", ")})`

export const invertTransformsForChildren = ({
  invertedChildren,
  matrix,
  body
}) => {
  invertedChildren.forEach(([child, childFlipConfig]) => {
    if (!body.contains(child)) {
      return
    }
    const scaleX = matrix[0]
    const scaleY = matrix[3]
    const translateX = matrix[4]
    const translateY = matrix[5]

    const inverseVals = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }
    let transformString = ""
    if (childFlipConfig.translate) {
      inverseVals.translateX = -translateX / scaleX
      inverseVals.translateY = -translateY / scaleY
      transformString += `translate(${inverseVals.translateX}px, ${
        inverseVals.translateY
      }px)`
    }
    if (childFlipConfig.scale) {
      inverseVals.scaleX = 1 / scaleX
      inverseVals.scaleY = 1 / scaleY
      transformString += ` scale(${inverseVals.scaleX}, ${inverseVals.scaleY})`
    }
    child.style.transform = transformString
  })
}

export const createApplyStylesFunc = ({ element, invertedChildren, body }) => ({
  matrix,
  opacity,
  forceMinVals
}) => {
  if (isNumber(opacity)) {
    element.style.opacity = opacity
  }

  if (forceMinVals) {
    element.style.minHeight = "1px"
    element.style.minWidth = "1px"
  }

  if (!matrix) return
  element.style.transform = convertMatrix2dArrayToString(matrix)

  if (invertedChildren) {
    invertTransformsForChildren({
      invertedChildren,
      matrix,
      body
    })
  }
}

export const rectInViewport = ({ top, bottom, left, right }) => {
  return (
    top < window.innerHeight &&
    bottom > 0 &&
    left < window.innerWidth &&
    right > 0
  )
}

const getInvertedChildren = (element, id) =>
  toArray(
    element.querySelectorAll(`[${constants.DATA_INVERSE_FLIP_ID}="${id}"]`)
  )

export const tweenProp = (start, end, position) =>
  start + (end - start) * position

const animateFlippedElements = ({
  flippedIds,
  flipCallbacks,
  inProgressAnimations,
  cachedFlipChildrenPositions,
  newFlipChildrenPositions,
  applyTransformOrigin,
  spring,
  getElement,
  debug,
  staggerConfig,
  decisionData
}) => {
  const body = document.querySelector("body")

  if (debug) {
    // eslint-disable-next-line no-console
    console.error(
      '[react-flip-toolkit]\nThe "debug" prop is set to true. All FLIP animations will return at the beginning of the transition.'
    )
  }

  const duplicateFlipIds = getDuplicateValsAsStrings(flippedIds)
  if (duplicateFlipIds.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[react-flip-toolkit]\nThere are currently multiple elements with the same flipId on the page.\nThe animation will only work if each Flipped component has a unique flipId.\nDuplicate flipId${
        duplicateFlipIds.length > 1 ? "s" : ""
      }: ${duplicateFlipIds.join("\n")}`
    )
  }

  const flipData = flippedIds
    // take all the measurements we need
    // and return an object with animation functions + necessary data
    .map(id => {
      const prevRect = cachedFlipChildrenPositions[id].rect
      const currentRect = newFlipChildrenPositions[id].rect
      const prevOpacity = cachedFlipChildrenPositions[id].opacity
      const currentOpacity = newFlipChildrenPositions[id].opacity
      const needsForcedMinVals = currentRect.width < 1 || currentRect.height < 1

      // don't initiateImmediateAnimations elements outside of the user's viewport
      if (!rectInViewport(prevRect) && !rectInViewport(currentRect)) {
        return false
      }
      // it's never going to be visible, so dont initiateImmediateAnimations it
      if (
        (prevRect.width === 0 && currentRect.width === 0) ||
        (prevRect.height === 0 && currentRect.height === 0)
      ) {
        return false
      }

      const element = getElement(id)

      // this might happen if we are rapidly adding & removing elements(?)
      if (!element) return false

      const flipConfig = JSON.parse(element.dataset.flipConfig)

      const springConfig = getSpringConfig({
        flipperSpring: spring,
        flippedSpring: flipConfig.spring
      })

      const stagger =
        flipConfig.stagger === true ? "default" : flipConfig.stagger

      const toReturn = {
        element,
        id,
        stagger,
        springConfig,
        noOp: true
      }

      if (flipCallbacks[id] && flipCallbacks[id].shouldFlip) {
        const elementShouldFlip = flipCallbacks[id].shouldFlip(
          decisionData.prev,
          decisionData.current
        )
        // this element wont be animated, but its children might be
        if (!elementShouldFlip) return toReturn
      }

      // don't initiateImmediateAnimations elements that didn't change
      // but we might want to initiateImmediateAnimations children
      if (
        prevRect.left === currentRect.left &&
        prevRect.top === currentRect.top &&
        prevRect.width === currentRect.width &&
        prevRect.height === currentRect.height &&
        prevOpacity === currentOpacity
      ) {
        // this element wont be animated, but its children might be
        return toReturn
      }

      toReturn.noOp = false

      const currentTransform = Rematrix.parse(
        newFlipChildrenPositions[id].transform
      )

      const toVals = { matrix: currentTransform }

      const fromVals = {}
      const transformsArray = [currentTransform]

      // we're only going to initiateImmediateAnimations the values that the child wants animated
      if (flipConfig.translate) {
        transformsArray.push(
          Rematrix.translateX(prevRect.left - currentRect.left)
        )
        transformsArray.push(
          Rematrix.translateY(prevRect.top - currentRect.top)
        )
      }
      // going any smaller than 1px breaks transitions in Chrome
      if (flipConfig.scale) {
        transformsArray.push(
          Rematrix.scaleX(
            Math.max(prevRect.width, 1) / Math.max(currentRect.width, 1)
          )
        )
        transformsArray.push(
          Rematrix.scaleY(
            Math.max(prevRect.height, 1) / Math.max(currentRect.height, 1)
          )
        )
      }

      if (flipConfig.opacity) {
        fromVals.opacity = prevOpacity
        toVals.opacity = currentOpacity
      }

      let invertedChildren = []

      if (
        !flipCallbacks[id] ||
        !flipCallbacks[id].shouldInvert ||
        flipCallbacks[id].shouldInvert(decisionData.prev, decisionData.current)
      ) {
        invertedChildren = getInvertedChildren(element, id).map(c => [
          c,
          JSON.parse(c.dataset.flipConfig)
        ])
      }

      fromVals.matrix = convertMatrix3dArrayTo2dArray(
        transformsArray.reduce(Rematrix.multiply)
      )

      toVals.matrix = convertMatrix3dArrayTo2dArray(toVals.matrix)

      const applyStyles = createApplyStylesFunc({
        element,
        invertedChildren,
        body
      })

      let onComplete
      if (flipCallbacks[id] && flipCallbacks[id].onComplete) {
        // must cache or else this could cause an error
        const cachedOnComplete = flipCallbacks[id].onComplete
        onComplete = () =>
          cachedOnComplete(element, decisionData.prev, decisionData.current)
      }

      // this should be called when animation ends naturally
      // but also when it is interrupted
      // when it is called, the animation has already been cancelled
      const onAnimationEnd = () => {
        delete inProgressAnimations[id]
        isFunction(onComplete) && onComplete()
        if (needsForcedMinVals && element) {
          element.style.minHeight = ""
          element.style.minWidth = ""
        }
      }

      const animateOpacity =
        isNumber(fromVals.opacity) && fromVals.opacity !== toVals.opacity

      let onStartCalled = false

      const getOnUpdateFunc = stop => {
        inProgressAnimations[id] = {
          stop,
          onComplete
        }
        return spring => {
          //trigger the user provided onStart function
          if (!onStartCalled) {
            onStartCalled = true
            if (flipCallbacks[id] && flipCallbacks[id].onStart)
              flipCallbacks[id].onStart(
                element,
                decisionData.prev,
                decisionData.current
              )
          }

          const currentValue = spring.getCurrentValue()

          if (!body.contains(element)) {
            stop()
            return
          }

          const vals = {}

          vals.matrix = fromVals.matrix.map((fromVal, index) =>
            tweenProp(fromVal, toVals.matrix[index], currentValue)
          )

          if (animateOpacity) {
            vals.opacity = tweenProp(
              fromVals.opacity,
              toVals.opacity,
              currentValue
            )
          }
          applyStyles(vals)
        }
      }

      const initializeFlip = () => {
        // before animating, immediately apply FLIP styles to prevent flicker
        applyStyles({
          matrix: fromVals.matrix,
          opacity: animateOpacity && fromVals.opacity,
          forceMinVals: needsForcedMinVals
        })
        // and batch any other style updates if necessary
        if (flipConfig.transformOrigin) {
          element.style.transformOrigin = flipConfig.transformOrigin
        } else if (applyTransformOrigin) {
          element.style.transformOrigin = "0 0"
        }

        invertedChildren.forEach(([child, childFlipConfig]) => {
          if (childFlipConfig.transformOrigin) {
            child.style.transformOrigin = childFlipConfig.transformOrigin
          } else if (applyTransformOrigin) {
            child.style.transformOrigin = "0 0"
          }
        })
      }

      return assign({}, toReturn, {
        stagger,
        springConfig,
        getOnUpdateFunc,
        initializeFlip,
        onAnimationEnd
      })
    })
    .filter(x => x)

  // call this immediately to put items back in place
  flipData.forEach(({ initializeFlip }) => initializeFlip && initializeFlip())

  if (debug) return

  const flipDict = flipData.reduce((acc, curr) => {
    acc[curr.id] = curr
    return acc
  }, {})

  // this function modifies flipData in-place
  // by removing references to non-direct children
  // to enable recursive stagger
  const { topLevelChildren } = filterFlipDescendants(flipDict, flippedIds)

  initiateAnimations({ topLevelChildren, flipDict, staggerConfig })
}

export default animateFlippedElements
