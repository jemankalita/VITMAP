import { Composition } from 'remotion'
import { DURATION, FPS, H, W } from './brand'
import { Film } from './Film'

export const Root: React.FC = () => (
  <Composition id="Film" component={Film} durationInFrames={DURATION} fps={FPS} width={W} height={H} />
)
