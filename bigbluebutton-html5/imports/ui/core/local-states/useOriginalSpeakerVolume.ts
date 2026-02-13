import createUseLocalState from './createUseLocalState';

const initialOriginalSpeakerVolume: number = 1;
const [useOriginalSpeakerVolume, setOriginalSpeakerVolume] = createUseLocalState<number>(initialOriginalSpeakerVolume);

export default useOriginalSpeakerVolume;
export { setOriginalSpeakerVolume };
