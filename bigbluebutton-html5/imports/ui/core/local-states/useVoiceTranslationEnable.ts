import createUseLocalState from './createUseLocalState';

const initialVoiceTranslationEnable: boolean = false;
const [useVoiceTranslationEnable, setVoiceTranslationEnable] = createUseLocalState<boolean>(initialVoiceTranslationEnable);

export default useVoiceTranslationEnable;
export { setVoiceTranslationEnable };
