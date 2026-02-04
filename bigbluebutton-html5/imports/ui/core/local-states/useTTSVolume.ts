import createUseLocalState from './createUseLocalState';

const initialTTSVolume: number = 1;
const [useTTSVolume, setTTSVolume] = createUseLocalState<number>(initialTTSVolume);

export default useTTSVolume;
export { setTTSVolume };
