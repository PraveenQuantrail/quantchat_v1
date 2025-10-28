import React, { useState } from 'react'

function useTextSpeechHook(pitch,rate,volume) {

    const [speaking,setSpeaking] = useState(false);
    const [text,setText] = useState("");
    
    const synth = window.speechSynthesis || null;
    const utterance = new SpeechSynthesisUtterance() || null

    // inserting text to utterance
    utterance.text = text || "";


    utterance.lang = 'en-US';
    utterance.pitch = pitch || 1;
    utterance.rate = rate || 1;
    utterance.volume = volume || 1
    

    utterance.onend = function(){
        setSpeaking(false);
    }

    function startSpeechHandler(textToSpeech) {
        setSpeaking(true);
        setText(textToSpeech);


        synth.speak(utterance);
    }

    function stopSpeechHandler() {
        synth.cancel();
        setSpeaking(false);
    }


    return {speaking,startSpeechHandler,stopSpeechHandler};
}

export default useTextSpeechHook
