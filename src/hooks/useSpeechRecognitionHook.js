import React, { useEffect, useState, useRef } from 'react'

function useSpeechRecognitionHook(onTranscript) {
    const [hasError, setHasError] = useState(false);
    const [listening, setListening] = useState(false);
    const [isMIC, setIsMIC] = useState(false);



    const RecongnitionRef = useRef(null);


    const MicrophoneWorking = () => {
        try {
            const permissionStatus = navigator.permissions.query({ name: 'microphone' });
            permissionStatus.state === 'granted' ? setIsMIC(true) : setIsMIC(false);
        }
        catch (err) {
            setHasError(true);
        }
    }

    const isSupportSpeechRecongnition = () => {
        return RecongnitionRef.current ? true : false;
    }


    useEffect(() => {

        const SpeechRecognition_v1 = window.SpeechRecognition || window.webkitSpeechRecognition;
        MicrophoneWorking()
        // init the speechRecognition contsr to useref
        RecongnitionRef.current = new SpeechRecognition_v1();
        RecongnitionRef.current.continuous = false; // disable the continous listening
        RecongnitionRef.current.interimResult = false;
        RecongnitionRef.current.lang = 'en-IN'; // default lang for model 

        // result event get the result of speech
        RecongnitionRef.current.addEventListener('result', (event) => {
            let finalTranscript = '';
            const transcript = event.results[event.results.length - 1][0].transcript;
            if (event.results[event.results.length - 1].isFinal) {
                finalTranscript += transcript + ' ';
            }

            onTranscript(finalTranscript);
        })


        // disable the listening after the recognition stop
        RecongnitionRef.current.onend = () => {
            setListening(false)
        }



        // error handle 
        RecongnitionRef.current.onerror = (event) => {
            console.log(event)
            setHasError(true)
        }



    }, [])



    // start listening function 
    function StartlisteningHandler() {
        if (RecongnitionRef.current !== null) {
            if (!listening) {
                setListening(true)
                RecongnitionRef.current.start()
            } else {
                setListening(false);
                RecongnitionRef.current.stop()
            }

        } else {
            setHasError(true);
        }
    }


    function StopListeningHandler() {
        if (RecongnitionRef.current !== null) {

            RecongnitionRef.current.stop();
            setListening(false);

        } else {
            setHasError(true);
        }
    }


    return { isSupportSpeechRecongnition, StartlisteningHandler, StopListeningHandler, listening, hasError, isMIC }
}

export default useSpeechRecognitionHook
