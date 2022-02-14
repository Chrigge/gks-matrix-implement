// Global vars
var roomID = "!HULaHFBnIxcwUEITua:gks-synapse";
var domain = "http://localhost:8008/";
var baseUrl = domain + "_matrix/client/v3"
var loginUrl = baseUrl + "/login";
var registerUrl = baseUrl + "/register?kind=user";
var longpollFrom = "END";

var accountInfo = {}; // Contains the account response from the API
var userInfo = {}; // Contains user info/stats (e.g. user name) / DEPRECATED, use myself

var eventLoopActive = true; // Whether to continue the event loop

var chatMessages = [];
var userList = [];
var usersReadyForMeeting = [];

var currentVote = null;
var voteInWizard = null;
var globalVotingMode = null;

var meetingHasStarted = false;
var meetingPhase = "";

var pastRandomStrings = []; // Contains a list of previously generated strings for the generateRandomString()

var syncTimestamp = Number.MAX_VALUE; // Contains the timestamp of the last accepted sync.
var originalTimestamp = Number.MAX_VALUE; // Contains the timestamp of when the user entered the room.

var myself = null; // User object representing the local user.


class User {
    constructor(name, joined=-1, id=-1, role="normal") {
        /**
         * Represents a user in the room.
         * There should also be an instance for the local user him-/herself.
         * @param name Name of the user as given by the Matrix API
         * @param joined Timestamp of when the user joined. Default to $.now().
         * @param id Unique ID for this user. Defaults to a random ID.
         * @param role This user's role. One of "normal", "mod", "spectator". Defaults to "normal".
         */

        if (id < 0) {
            id = "u" + $.now() + "-" + generateRandomString(); // Unique ID to make name collisions possible
        }

        if (joined < 0) {
            joined = $.now();
        }

        this.name = name;
        this.joined = joined;
        this.id = id;
        this.role = role;
    }

    toString() {
        var prefix = "";
        if (this.role == "mod") {
            prefix += "(m) ";
        }
        return prefix + this.name;
    }

    toJSON() {
        return '{'
            + '"id": "' + this.id + '",'
            + '"name": "' + this.name + '",'
            + '"joined": "' + this.joined + '",'
            + '"role": "' + this.role + '"'
            + '}';
    }
}

class ChatMessage {
    constructor(author, message, timestamp, type) {
        /**
         * Represents a single message in the chat.
         * @param author author of the message
         * @param message message body
         * @param timestamp timestamp of the message
         * @param type type of the message. 
         *              This mainly influences the background color of this chat message to make it stand apart.
         *              One of "msgStandard", "msgMod", "msgSys"
         */
        this.author = author;
        this.message = message;
        this.timestamp = timestamp;
        this.type = type;
    }

    toString() {
        return '<div class="' + this.type + '">' + this.author + ': ' + this.message + "</div>";
    }

    toJSON() {
        return '{'
            + '"author": "' + this.author + '",'
            + '"message": "'+ this.message + '",'
            + '"timestamp": "' + this.timestamp + '",'
            + '"type": "' + this.type + '"'
            + '}';
    }
}

class Vote {
    constructor(title, desc, voteItems = [], id = "", mode = "consensus", effectType = "") {
        /**
         * Represents a vote. This contains a list of voteItems, i.e. things you can vote for.
         * @param title Title of the vote. Should be short & concise.
         * @param desc Description of the vote. Shouldn't extend past 3-4 lines or smth.
         * @param voteItems List of voteItems, i.e. the things you can vote for. These can also be added later @TODO
         * @param id Unique identifier of this VoteItem (should be the same across each client for this VoteItem). If left blank, it will be auto-generated.
         * @param mode Voting mode. One of "consensus", "absMajority", "relMajority".
         * @param effectType What (and if) something special should happen due to the result. One of "", "voteMod", "removeMod", "votingMode". Defaults to "".
         */
        this.title = title;
        this.desc = desc;
        this.voteItems = voteItems;
        this.id = id;
        this.mode = mode;
        this.effectType = effectType;
        if (id == "") {
            var _id = $.now() + "-" + generateRandomString();
            this.id = _id;
        }
        // Whether voting has finished or not.
        this.isFinished = false;
        // The object containing the result returned by this.getResult();
        this.result = null;
    }

    toJSON() {
        var voteItemsJSON = []
        for (let i = 0; i < this.voteItems.length; i++) {
            voteItemsJSON.push(this.voteItems[i].toJSON());
        }
        
        var effectJSON = '{'
            + ' "type": "' + this.effectType// + '",'
           // + ' "target":' + this.effectTarget + '"'
            + '" }';

        var s = '{'
            + '"title": "' + this.title
            + '", "desc": "' + this.desc
            + '", "id": "' + this.id
            + '", "mode": "' + this.mode
            + '", "voteItems": [' + voteItemsJSON + ']'
            + ', "isFinished": ' + this.isFinished
            + ', "effect": ' + effectJSON
            + '}';
        
        return s;
    }

    constructHTML() {
        /**
         * DEPRECATED - THIS IS DONE STATICALLY TO ATTACH EVENT HANDLERS
         * @see updateVoteHTML(vote)
         * Constructs HTML code for pasting into the voting div.
         * This contains the title, the description and the voteItems.
         */
        var s = "";
        s += "<div class='voteTitle'>" + this.title + "</div>";
        s += "<div class='voteDesc'>" + this.desc + "</div>";
        for (let i = 0; i < this.voteItems.length; i++) {
            var isEven = (i % 2 == 0);
            s += voteItems[i].constructHTML(isEven);
        }

        return s;
    }

    getVoteItemByID(id) {
        /**
         * Returns a VoteItem contained within this Vote via its ID, or nothing if it is not contained.
         * @param id the id of the VoteItem
         * @return the VoteItem that was found, or null if nothing was found.
         */
        for (let i = 0; i < this.voteItems.length; i++) {
            var item = this.voteItems[i];
            if (item.id == id) {
                return item;
            }
        }
        return null;
    }

    getVotedItems() {
        /**
         * Returns an array of VoteItem that are selected/voted for by the user
         * @return an array of VoteItem that are selected/voted for by the user
         */
        var list = [];
        for (let i = 0; i < this.voteItems.length; i++) {
            if (this.voteItems[i].isSelected) {
                list.push(this.voteItems[i]);
            }
        }
        return list;
    }

    getResult() {
        /**
         * Returns the result of the vote.
         * Usage is primarily for finished votes, but can also be used to return preliminary results.
         * Returns an object with the following parameters:
         * - result: The vote item that was chosen. This is null if the vote didn't result in a decision according to the mode selected.
         * - tally: a list with entries that associate each possible vote item with the number of votes it received
         * @return an object with the parameters given above.
         */

        if (this.voteItems.length == 0) {
            return null;
        }

        let valid = false;
        let tally = [];
        let multipleBestItems = false;
        let numberOfItemsWithAtLeastOneVote = 0;
        let maxVotedItem = this.voteItems[0];
        // Get the tally for each voteItem and add a corresponding entry to the dict
        for (let i = 0; i < this.voteItems.length; i++) {
            let item = this.voteItems[i];
            let entry = {item: item.votes};
            
            tally.push(entry);
            if (item.votes.size == maxVotedItem.votes.size) {
                maxVotedItem = item;
                multipleBestItems = true;
            }
            else if (item.votes.size > maxVotedItem.votes.size) {
                maxVotedItem = item;
                multipleBestItems = false;

            }
            

            if (item.votes.size > 0) {
                numberOfItemsWithAtLeastOneVote++;
            }
        }

        let result = null;
        
        switch (this.mode) {
            case "relMajority":
                if (!multipleBestItems) {
                    result = maxVotedItem;
                    valid = true;
                }
                break;
            
            case "absMajority":
                if (!multipleBestItems && maxVotedItem.votes.size > (Math.floor(userList.size / 2))) {
                    result = maxVotedItem;
                    valid = true;
                }
            
            case "consensus":
                if (numberOfItemsWithAtLeastOneVote == 1) {
                    result = maxVotedItem;
                    valid = true;
                }
        }

        return {
            result: maxVotedItem,
            tally: tally,
            valid: valid
        };
    }

    finishVote() {
        /**
         * Ends the voting process for this Vote and gets the result.
         * Also applies special effects if any are specified.
         */
        this.result = this.getResult();
        if (!this.result.valid) {
            this.result = null;
            return false;
        }
        this.isFinished = true;
        updateVoteHTML(currentVote);
        switch (currentVote.effectType) {
            case "":
                break;
            
            case "voteMod":
                // Promote new mod
                let newMod = getUserByUserID(this.result.result.values.userID);
                if (newMod != null) {
                    newMod.role = "mod";
                }
                // If this was a mod vote phase-vote, advance the meeting phase and tell other clients.
                if (meetingPhase == "chooseMods") {
                    sendMeetingDiscussionPhase();
                    
                }

                updateUserListHTML();
                console.log("made " + newMod.name + " a mod!");
                break;
            
            case "removeMod":
                let oldMod = getUserByUserID(this.result.result.values.userID);
                if (oldMod != null) {
                    oldMod.role = "normal";
                }
                updateUserListHTML();
                console.log("removed " + oldMod.name + "'s mod status");
                break;
            
            case "votingMode":
                globalVotingMode = JSON.parse(this.result.result.values).mode;
                console.log(globalVotingMode);

                // If this was a voting mode vote, advance the meeting phase and tell other clients.
                if (meetingPhase == "chooseVotingFormat") {
                    sendModVotingPhase();
                }
                break;
        }
        
        return true;
    }
}

class VoteItem {
    constructor(vote, desc, id = "", values = {}) {
        /**
         * Represents a single item in a vote that can be voted for. Also stores current votes.
         * @param vote The instance of Vote this VoteItem belongs to.
         * @param desc Description of this item
         * @param id Unique identifier of this VoteItem (should be the same across each client for this VoteItem). If left blank, it will be auto-generated.
         */
        this.vote = vote;
        this.desc = desc;
        this.votes = new Set();
        this.id = id;
        this.values = values;
        if (id == "") {
            var _id = vote.id + $.now() + "-" + generateRandomString();
            this.id = _id;
        }

        // isSelected determines whether this voteItem is selected by the user or not.
        // DO NOT SET THIS MANUALLY - use setIsSelected(selected) instead.
        // This avoids accidentally changing selected items when a vote is already finished.
        this.isSelected = false


    }

    toJSON() {
        var votesStr = "";
        var votesArr = Array.from(this.votes);
        for (let i = 0; i < votesArr.length; i++) {
            votesStr += votesArr[i];
            if (i < votesArr.length - 1) {
                votesStr += ", ";
            }
        }
        return '{ "desc": "' + this.desc
         + '", "id": "' + this.id
         + '", "votes": [' + votesStr
         + ']'
         + ', "values": ' + JSON.stringify(this.values)
         + '}';
    }

    setIsSelected(isSelected) {
        /**
         * Setter which sets whether the VoteItem is selected or not.
         * This has its own setter to avoid changing selected items when a vote has finished.
         * Does nothing if either the vote has finished or there is no Vote associated with this object.
         * @param selected whether this item was selected or not.
         * @return whether it is possible to set isSelected or not according to the rules above. Does not say whether it was actually changed or not (i.e. if it was true before and should now be set to true)
         */
        if (this.vote == null) {
            alert("This item does not have an associated Vote");
            return false;
        }

        if (this.vote.isFinished) {
            alert("Vote has finished already");
            return false;
        }

        this.isSelected = isSelected;
        return true;
    }

    constructHTML(index) {
        /**
         * Constructs HTML code for this vote item. Should only be used by a Vote-object's constructHTML().
         * @param index The index of this voteItem in the list.
         */
        var isEven = (index % 2 == 0);
        var layoutClass = "voteItemEven";
        if (!isEven) {
            layoutClass = "voteItemUneven";
        }
        if (this.isSelected) {
            layoutClass = "voteItemSelected";
        }
        if (this.vote != null) {
            if (this.vote.isFinished && this.vote.result != null) {
                if (this.vote.result.result.id == this.id) {
                    layoutClass = "voteItemAccepted";
                }
                else {
                    layoutClass = "voteItemRejected";
                    
                }
            }
        }
        var s = "";
        s += "<div class='voteItem " + layoutClass + "' id='" + this.id + "'>" + this.desc + "<br/>Votes: " + this.votes.size + "</div>";
        return s;
    }
}

function switchOverlayWindow(windowType) {
    $("#overlayWaitForMeetingDiv").hide();
    $("#overlayNewVoteDiv").hide();
    $("#overlayWindowCloseButton").hide();

    switch(windowType) {
        case "voteWizard":
            $("#overlayWindow").show();
            $("#overlayNewVoteDiv").show();
            $("#overlayWindowCloseButton").show();
            break;
        
        case "waitForMeetingStart":
            $("#overlayWindow").show();
            $("#overlayNewVoteDiv").hide();
            $("#overlayWaitForMeetingDiv").show();
            break;

        default:
            $("#overlayWindow").hide();
            break;
    }
}

function voteWizardInit() {
    /**
     * Opens the voting wizard window and puts a new, empty Vote object into voteInWizard.
     */
    voteInWizard = new Vote("", "");
    voteWizardUpdate();
    switchOverlayWindow("voteWizard");
}

function voteWizardUpdate() {
    /**
     * Updates voteInWizard to reflect the entries given in the wizard window
     */
    voteInWizard.title = $("#overlayNewVoteTitleInput").val();
    voteInWizard.desc =  $("#overlayNewVoteDescInput").val();
    voteInWizard.mode =  $("input[name='mode']:checked").val();
    voteWizardUpdateHTML();
}

function voteWizardFinalize() {
    /**
     * Applies the created Vote as the current vote, closes window, broadcasts it etc.
     */
    // currentVote = voteInWizard;
    switchOverlayWindow("");
    // updateVoteHTML(currentVote);
    // updateVoteHTML(voteInWizard);
}

function voteWizardUpdateHTML() {
    $("#overlayNewVoteItemsListDiv").html("");
    for(var i = 0; i < voteInWizard.voteItems.length; i++) {
        var item = voteInWizard.voteItems[i];
        var id = item.id;
        $("#overlayNewVoteItemsListDiv").append(item.constructHTML(i));
        // Add removal function when item is clicked
        $(id).on("click", function(event) {
            var _id = event.target.id;
            var _item = voteInWizard.getVoteItemByID(_id);
            if (_item == null) {
                alert ("Something went wrong - this vote item shouldn't be here...");
                return;
            }
            var _index = voteInWizard.voteItems.indexOf(_item);
            if (index > -1) {
                voteInWizard.voteItems.splice(_index, 1);
            }
        });
    }
}


function tryLogin(user, pass) {
    /**
     * Tries to login the user using the given credentials.
     * Also constructs the User object for the local user.
     */
    myself = new User(user, $.now());
    // userList.push(myself);

    var ajaxData = JSON.stringify({user: user, password: pass, type:"m.login.password"});

    // Call the API for log in
    $.ajax({
        url: loginUrl,
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: ajaxData,
        dataType: "json",
        success: function(responseData) {
            // If successful, overwrite accountInfo with the response data.
            // Important since the response data contains the access token.
            // Also call the function that switches views from login- to chat screen
            accountInfo = responseData;
            userInfo = {user: user};

            switchScreen("joinRoom");
        },
        error: function(errorData) {
            // If unsuccessful, try again?
            console.log("Login failed!");
        }
    });

    console.log("Logging in " + user + " to " + roomID);
}


function tryRegister(user, pass, passRepeat) {
    /**
     * Tries to register the user using the given credentials
     */

    // If the repeat of the password doesn't match the original, stop
    if (pass != passRepeat) {
        alert("Passwords don't match!");
        return false;
    }

    var ajaxData = JSON.stringify({username: user, password: pass});
    var session = "";
    // Send register request.
    // Note that the API specifies the following procedure:
    //  First, send a request containing only the user/pass, which the API
    //  answers with a 401 error that contains the possible login methods ("flows")
    //  as well as the session ID.
    //  Then send further messages following the steps given by the API reply.
    //  We simply choose the easiest (and least secure :) ) method: m.login.dummy
    $.ajax({
        url: registerUrl,
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: ajaxData,
        dataType: "json",
        success: function(data) {
            alert("How did this succeed? We should get a 401 here");
        },
        error: function(responseData) {
            console.log(responseData);
            if (responseData.status != 401) {
                alert("Something went wrong, try again");
            }
            else {
                session = responseData.responseJSON.session;
                
                // Append auth data to ajaxData for the next call
                // (expected by the API)
                var auth = JSON.stringify({ auth: {
                        type: "m.login.dummy",
                        session: session,
                    },
                    username: user,
                    password: pass
                });

                // Send next request
                $.ajax({
                    url: registerUrl,
                    type: "POST",
                    contentType: "application/json; charset=utf-8",
                    data: auth,
                    dataType: "json",
                    success: function(responseData) {
                        alert("User registration successful!");
                        console.log(responseData);
                        tryLogin(user, pass);
                    },
                    error: function(responseData) {
                        alert(":(");
                        console.log(responseData);
                    }
                });
            }
        }

    })
}


function tryJoinRoom(room) {
    var url = baseUrl + "/rooms/$roomid/join?access_token=$token";
    url = url.replace("$token", accountInfo.access_token);
    url = url.replace("$roomid", encodeURIComponent(room));

    var ajaxData = JSON.stringify({roomId: room});

    $.ajax({
        url: url,
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: ajaxData,
        dataType: "json",
        success: function(responseData) {
            roomID = room;
            switchScreen("chat");
        },
        error: function(responseData) {
            alert("Error joining room");
            console.log(responseData);
        }
    });
}


function switchScreen(screen) {
    /**
     * Switch from login- to chat screen.
     * @param screen The name of the screen to be switched to:
     *  - "login"
     *  - "register"
     *  - "chat"
     *  - "joinRoom"
     */

    // Hide all screens
    $("#chatScreen").hide();
    $("#loginScreen").hide();
    $("#registrationScreen").hide();
    $("#roomSelectScreen").hide();
    $("p.userInfo").text("User: " + userInfo.user);

    // Reset constant pulling of chat messages (activated if chat screen is selected)
    eventLoopActive = false; 

    // Show only the currently used screen
    switch(screen) {
        case "login":
            $("#loginScreen").toggle();
            break;
        
        case "register":
            $("#registrationScreen").toggle();
            break;
        
        case "chat":
            // Switch to chat screen
            $("#chatScreen").toggle();

            // Synchronize timestamps with current time
            syncTimestamp = $.now();
            originalTimestamp = syncTimestamp;
            
            // Start chat polling event loop and send a user join- and meeting sync request.
            eventLoopActive = true;
            if (meetingPhase == "") {
                goToNextMeetingPhase();
            }
            sendUserEnter(myself);
            sendSyncMeetingRequest();
            longpollRoomEvents(0, true);

            // Update the shown vote's HTML.
            updateVoteHTML(currentVote);
            break;
        
        case "joinRoom":
            $("#roomSelectScreen").toggle();
            break;
    }
}


function sendMessage(msg) {
    /**
     * Sends a chat message to the current chat room
     * @param msg contains the message in the form { msgtype: type, body: "Chat message" }
     */

    var msgID = $.now();

    var url = baseUrl + "/rooms/$roomid/send/m.room.message?access_token=$token";
    url = url.replace("$token", accountInfo.access_token);
    url = url.replace("$roomid", encodeURIComponent(roomID));

    var msgData = JSON.stringify({
        msgtype: msg.msgtype,
        body: msg.body
    });

    $.ajax({
        url: url,
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: msgData,
        dataType: "json",
        success: function(responseData) {
        },
        error: function(errorData) {
            console.log("Sending failed");
            console.log(errorData);
        }
    })
}


function sendChatMessage(msg, msgType="msgStandard") {
            // Check if this user is a mod. Only highlight if this would be a msgStandard otherwise.
            let modList = getModList();
            for (let i = 0; i < modList.length; i++) {
                if (modList[i].id == myself.id && msgType == "msgStandard") {
                    msgType = "msgMod";
                }
            }               
    
            console.log(getModList());
            var msg = { 
                msgtype: "m.text",
                body: '{"text": "' + msg + '",'
                +     ' "type": "' + msgType + '"}' };
            sendMessage(msg);
}


function sendUserEnter(user) {
    /**
     * Sends a message that signals that a user has entered the chat.
     * Usually, the client entering sends this with his/her self-representating User object.
     * @param user the User object of the client that entered the chat.
     */

    var msg = {
        msgtype: 'm.userenter',
        body: '{ "user": ' + user.toJSON() + '}'
    }

    sendMessage(msg);
}

function sendUserLeave() {
    /**
     * Sends a message that signals that this client has left the chat.
     * Usually, the client entering sends this with his/her self-representating User object.
     * @TODO this is super unsafe - by sending a custom message, people may kick other people out.
     * @param user the User object of the client that entered the chat.
     */

    if (myself == null) {
        return;
    }

    var msg = {
        msgtype: 'm.userleave',
        body: '{ "user": ' + myself.toJSON() + '}'
    }

    sendMessage(msg);
}

function sendReadyForMeeting() {
    /**
     * Sends a message to all participants signalling that this client is ready for the meeting.
     */
    var msg = {
        msgtype: 'm.readyformeeting',
        body: '{ "user": ' + myself.toJSON() + '}'
    }

    sendMessage(msg);
}


function sendMeetingStart() {
    /**
     * Sends a notice that tells everyone to start the meeting.
     * Clients will only take the message of the "oldest" client in the meeting list
     *  and start a vote in that case (i.e. advance the meeting phase).
     */
        var msg = {
        msgtype: "m.meetingstart",
        body: '{ "user": ' + myself.toJSON() + '}'
    };

    sendMessage(msg);
}

function sendModVotingPhase() { 
   /**
    * Sends a notice to all clients that the mod voting phase has been entered.
    * This happens after the voting mode vote phase. Only takes the message of the "oldest" client.
    */
    var msg = {
       msgtype: "m.choosemodsphase",
       body: '{ "user": ' + myself.toJSON() + '}'
   };

   sendMessage(msg);
}

function sendMeetingDiscussionPhase() {
    /**
     * Sends a notice to all clients that the main discussion phase has been entered.
     * This happens after the mod voting phase. Only takes the message of the "oldest" client.
     */
     var msg = {
        msgtype: "m.meetingdiscussionphase",
        body: '{ "timestamp": ' + syncTimestamp + '}'
    };

    sendMessage(msg);
}

function sendStartDecisionProcess() {
    /**
     * Sends a notice to all clients that the main discussion phase has been entered.
     * This happens when a mod presses the correspondin button.
     */
     var msg = {
        msgtype: "m.startdecisionprocess",
        body: '{ "timestamp": ' + syncTimestamp + '}'
    };

    sendMessage(msg);
}


function sendChangeUserRole(userID, newRole) {
    /**
     * Sends a message to all participants signalling that a user has changed his/her role.
     * @param userID id of the user with new role
     * @param newRole new role for the user.
     */

    var msg = {
        msgtype: 'm.changeuserrole',
        body: '{ "userID": "' + userID + '", "newRole": "' + newRole + '" }' 
    };

    sendMessage(msg);
}


function sendNewVote(vote) {
    /**
     * Sends a message to all participants signalling that a new vote has started
     * Should only be sent by moderators
     * @TODO mod verification
     * @param vote contains the vote to be sent.
     */

    var msg = {
        msgtype: "m.newvote",
        body: '{"currentVote": ' + vote.toJSON() + ','
            + '"origin": "' + myself.id + '"'
            + '}'
    };

    sendMessage(msg);
    sendChatMessage("Neue Abstimmung: " + vote.title, "msgSys");
}

function sendEndMeeting() {
       /**
    * Sends a notice to all clients that the meeting has ended.
    * Clients will only accept this if they verified that the message was sent by either a mod or if there is no mod in the room.
    */
        var msg = {
            msgtype: "m.endmeeting",
            body: '{ "user": ' + myself.toJSON() + '}'
        };

}

function sendSyncMeetingRequest() {
    /**
     * Sends a sync request to all participants. This is called when you enter the room.
     */
    var msg = {
        msgtype: "m.syncmeetingrequest",
        body: '{ "timestamp": ' + syncTimestamp + '}'
    };

    sendMessage(msg);
}

function sendSyncMeeting() {
    /**
     * Sends a message containing all known infos in the room.
     * The receiver should pick the client that has been a member of the room the longest
     *  as its information source. However, every client answers independently with this
     *  when a m.syncmeetingrequest is received.
     */

    var meetingStateJSON = JSON.stringify(getMeetingStateJSON());
    
    var msg = {
        msgtype: "m.syncmeeting",
        body: meetingStateJSON
    };

    sendMessage(msg);
}

function sendVoteFinished(voteID) {
        /**
     * Sends a message to all participants signalling that a vote has ended
     * Should only be sent by moderators
     * @TODO mod verification
     * @param voteID contains the ID of the vote that finished.
     */

         var msg = {
            msgtype: "m.votefinished",
            body: '{ "voteID": "' + voteID + '"}'
        };
    
        sendMessage(msg);
}

function sendVotedItem(votedItemID, voteID) {
    /**
 * Sends a message to all participants containing the ID of the items voted for.
 * Should only be sent by moderators
 * @TODO mod verification
 * @param voteItemID contains the ID of the voteItem(s) that were chosen
 * @param voteID contains the ID of the vote that finished.
 */
    var votedItemStr = "";
    for (let i = 0; i < votedItemID.length; i++) {
        votedItemStr += '"' + votedItemID[i] + '"';
        if (i < votedItemID.length - 1) {
            votedItemStr += ", "
        }
    }
    var msg = {
        msgtype: "m.voteditem",
        body: '{'
            + '"voteID": "'+ voteID + '",'
            + '"votedItemID": [' + votedItemStr +  ']'   
            + '}'
    };

    sendMessage(msg);
}

function sendSyncFinishedVote(vote) {
    /**
 * Sends a message to all participants signalling that a vote has ended
 * Should only be sent by moderators
 * This doesn't work if vote.result has not yet been determined (i.e. the vote hasn't finished)
 * @TODO mod verification
 * @param vote contains the vote to be synced.
 * @param result contains the vote's result
 * @return whether there was a result to be sent (but not whether the msg was sent successfully - see the log for infos about that).
 */
    if (vote.result == null || !vote.isFinished) {
        return false;
    }
    
    var msg = {
        msgtype: "m.syncfinishedvote",
        body: "{ vote: " + JSON.stringify(vote) + ", result: " + JSON.stringify(vote.result) + "}"
    };

    sendMessage(msg);
    return true;
}



function longpollRoomEvents(since, forward=true) {
    /**
     * Polls the API for new room events, such as messages etc.
     * This acts as a long poll loop: A request is sent to the server,
     * which then responds as soon as a new event occurs.
     * Once the server sent an event, this function calls itself
     * i.e. sends a new message to the server.
     * @param since lets the server know the time from which to send new events.
     *              This should be 0(?) on initial sync.
     * @param forward If true, polling will get the next message blocks. If false, it will get the previous ones (recursively until it hits a m.meetingstart).
     */
    var timeout = 5000; // 5 seconds till timeout (i.e. when the server is forced to respond)

    var data = {
        timeout: timeout,
        since: since
    };

    var url = baseUrl + "/sync?access_token=" + accountInfo.access_token
            + "&timeout=" + timeout;
    if (since != 0) {
        url = url + "&since=" + since;
    }

    $.getJSON(url, function(receivedData) {

            longpollFrom = receivedData.end;

            // Process the received data.
            // Only do this if since is not zero, i.e. this is not the initial sync -
            //  we want to do syncing on our own since we have more to sync and
            //  old messages may be untrustworthy.
            //  Also, broken message formatting may mess with the client,
            //  so it's important to be able to reset everything in the worst case (as a fail-safe).
            //  (@TODO This is bad, but catching every bad format would be a lot of work)
            if (since != 0) {
                processReceivedEvents(receivedData);
            }

            // Call this function recursively
            if (forward) {
                longpollRoomEvents(receivedData.next_batch, forward);
            }
            else if (!meetingHasStarted) {
                longpollRoomEvents(receivedData.prev_batch, forward);
            }
        });
}


function processReceivedEvents(data) {
    /**
     * Processes events (i.e. messages) sent by other clients and acts accordingly.
     * @param data the original message received.
     */
    
    // Cancel if no new events were received in the data
    if (!('rooms' in data)) {
        return false;
    }

    // Events seem to be stored in data.rooms.join[roomID].timeline.events, so simplify
    var events = data.rooms.join[roomID].timeline.events;
    console.log("Received msg:");
    console.log(events);

    // Cycle through events and process them one-by-one
    for (let i = 0; i < events.length; i++) {
        var event = events[i];
        var result = JSON.parse(event.content.body);
        console.log(result);
     
        
        switch (event.content.msgtype) {
            case "m.text": {
                var message = new ChatMessage(event.sender, result.text, event.origin_server_ts, result.type);
                pushChatMessage(message);
                break;
            }


            case "m.userenter": {
                var userData = result.user;
                let user = new User(userData.name, userData.joined, userData.id, userData.role);
                userList.push(user);
                updateUserListHTML();
                updateWaitForMeetingStartWindowHTML();
                break;
            }
            
            case "m.userleave": {
                let id = result.user.id;
                let _user = null;
                for (let j = 0; j < userList.length; j++) {
                    _user = userList[j];
                    if (_user.id == id) {
                        userList.splice(j, 1);
                    }
                }
                if (_user != null) {
                    console.log("User " + id + " left");
                    chatMessages.push(new ChatMessage("system", _user.name + " hat den Chat verlassen", $.now()))
                }
                else {
                    console.log("User that left wasn't in the user list");
                }
                updateUserListHTML();
                updateWaitForMeetingStartWindowHTML();
                break;
            }
            
            
            case "m.readyformeeting": {
                for (let i = 0; i < usersReadyForMeeting.length; i++) {
                    if (usersReadyForMeeting.id == result.userID) {
                        break;
                    }
                }
                let _user = new User(result.name, result.joined, result.id, result.role);
                usersReadyForMeeting.push(_user);
                updateWaitForMeetingStartWindowHTML();
                break;
            }


            case "m.meetingstart": {
                // There are multiple message event cases with the same structure (or exact same code).
                // The reason for repeating is for easier maintenance, since other events may require
                //  other code details later on.
                // @TODO concatenate these functions?
                let oldestUser = null;
                for(let i = 0; i < userList.length; i++) {
                    if (result.user.joined < myself.joined) {
                        oldestUser = getUserByUserID(result.user.id);
                    }
                }
                // Only send a start meeting-request if the message is sent by the oldest user in your meeting list (@TODO this is pretty bad - unsynced user lists may lead to a client not advancing its phase before syncing)
                if (oldestUser.id != result.user.id) {
                    break;
                }
    
                goToNextMeetingPhase();
                break;
            }

            case "m.choosevotingformat": {
                let oldestUser = null;
                for(let i = 0; i < userList.length; i++) {
                    if (result.user.joined < myself.joined) {
                        oldestUser = getUserByUserID(result.user.id);
                    }
                }
                // Only send a start meeting-request if the message is sent by the oldest user in your meeting list (@TODO this is pretty bad - unsynced user lists may lead to a client not advancing its phase before syncing)
                if (oldestUser.id != result.user.id) {
                    break;
                }
                
                goToNextMeetingPhase();
                break;
            }

                
            case "m.choosemodsphase": {
                let oldestUser = myself;
                for(let i = 0; i < userList.length; i++) {
                    if (result.user.joined < myself.joined) {
                        oldestUser = getUserByUserID(result.user.id);
                    }
                }
                // Only send a start meeting-request if the message is sent by the oldest user in your meeting list (@TODO this is pretty bad - unsynced user lists may lead to a client not advancing its phase before syncing)
                if (oldestUser.id != result.user.id) {
                    break;
                }
                
                goToNextMeetingPhase();
                break;
            }

            case "m.meetingdiscussionphase": {
                goToNextMeetingPhase();
                break;
            }

            case "m.startdecisionprocess": {
                goToNextMeetingPhase();
                alert("Start dec prco");
                break;
            }


            case "m.endmeeting":
                let eligiblePhases = ["mainDiscussion", "decisionProcessDiscussion", "decisionProcessVote"];
                if (!(eligiblePhases.includes(meetingPhase))) {
                    sendSyncMeetingRequest();
                    break;
                }
                // Remove all mod powers
                for (let i = 0; i < userList.length; i++) {
                    if (getModList().includes(userList[i])) {
                        userList[i].role = "";
                    }
                }
                alert("Meeting has ended!");
                updateUserListHTML();
                updateChatMessagesHTML();
                break;

            
            

            case "m.changeuserrole": {
                let _user = null;
                for (let i = 0; i < userList.length; i++) {
                    _user = userList[i];
                    if (_user.id == result.userID) {
                        break;
                    }
                }
                if (_user != null) {
                    _user.role = result.newRole;
                }
                updateChatMessagesHTML();
                updateUserListHTML();
                break;
            }

            
            case "m.newvote": {
                var vote = getVoteFromMessage(result.currentVote);
                
                if (getUserByUserID(result.origin).role == "mod" || vote.effectType == "voteMod" 
                                                                 || vote.effectType == "removeMod"
                                                                 || (getModList().length == 0 && vote.effectType == "votingMode")
                                                                 || globalVotingMode == null) {
                    currentVote = vote;
                    console.log(getUserByUserID(result.origin));
                }
                else {
                    // If the origin user wasn't a mod, try to resync the room instead.
                    console.log("Insufficient permissions to create a vote");
                    sendSyncMeetingRequest();
                }
                // Go to the next phase or re-sync if phases seem to be out of order
                if (meetingPhase == "decisionProcessDiscussion") {
                    goToNextMeetingPhase();
                }
                else {
                    sendSyncMeetingRequest();
                }
                
                updateVoteHTML(currentVote);
                break;
            }
            

            case "m.votefinished": {
                if (currentVote == null) {
                    // @TODO handle what happens here (re-request the current vote?)
                    break;
                }
                 
                if (currentVote.id != result.voteID) {
                    console.log("Vote finished received, but got an unknown vote ID");
                    sendSyncMeetingRequest();
                    break;
                }
                // Go to the next phase or re-sync if phases seem to be out of order
                if (meetingPhase == "decisionProcessVote") {
                    goToNextMeetingPhase();
                }
                else {
                    sendSyncMeetingRequest();
                }
                
                // alert("Vote finished!" + result.voteID);
                currentVote.finishVote();
                break;
            }
            

            case "m.voteditem": {
                // alert("wowoof");
                var ids = result.votedItemID;
                var author = event.sender;
                if (currentVote == null) {
                    // @TODO handle what happens here (re-request the current vote?)
                    alert("Current vote is null!");
                    break;
                }
                 
                if (currentVote.id != result.voteID) {
                    console.log("Vote item selection received, but got an unknown vote ID");
                    sendSyncMeetingRequest();
                    break;
                }
                
                var l = 0;
                for (let x = 0; x < currentVote.voteItems.length; x++) {
                    var _item = currentVote.voteItems[x];
                    // Check if the author is already in a voteItem's votes and if so, remove him*her from the voteItem's set
                    if (_item.votes.has(author)) {
                        _item.votes.delete(author);
                    }
                    // Add author to corresponding voteItem's votes
                    for (let j = 0; j < ids.length; j++) {
                        if (_item.id == ids[j]) {
                            _item.votes.add(author);
                        }
                    }
                }
                updateVoteHTML(currentVote);
                break;
            }


            case "m.syncmeetingrequest": {
                if (result.timestamp > syncTimestamp) {
                    sendSyncMeeting();
                    console.log("Sent sync!");
                    
                }
                else {
                    console.log("Did not accept sync - request was ours or older than we are...");
                }
                break;
            }


            case "m.syncmeeting": {
                // Sync the meeting if the received msg's timestamp is older than our own.
                if (result.timestamp < syncTimestamp) {
                    console.log("Starting sync...");
                    var newChatMessages = [];
                    var newUserList = [];

                    for (let x = 0; x < result.chatMessages.length; x++) {
                        var msg = JSON.parse(result.chatMessages[i]);
                        newMsg = new ChatMessage(msg.author, msg.message, msg.timestamp);
                        newChatMessages.push(newMsg);
                    }

                    for (let x = 0; x < result.userList.length; x++) {
                        var msg = JSON.parse(result.userList[x]);
                        _user = new User(msg.name, msg.joined, msg.id, msg.role);
                        newUserList.push(_user);
                    }

                    currentVote = getVoteFromMessage(JSON.parse(result.currentVote));
                    userList = newUserList;
                    chatMessages = newChatMessages;
                    syncTimestamp = result.timestamp;
                    meetingPhase = result.meetingPhase;
                    updateChatMessagesHTML();
                    updateUserListHTML();
                    updateWaitForMeetingStartWindowHTML();
                }
                break;
            }
            
            default: {
                break;
            }
        }
    }
}



function goToNextMeetingPhase() {
    /**
     * This changes the meeting phase and does everything associated with the change.
     * Phases and effects:
     * - "": Initial phase, this function should be called as soon as possible.
     * - "waitForMeetingToStart": Waits until all users hit the "start meeting"-button.
     * - "chooseVotingFormat": Creates a votingModeVote and waits for it to finish.
     * - "chooseMods": Creates a modVote and waits for it to finish.
     * - "mainDiscussion": Waits until a mod starts a decision process.
     * - "decisionProcessDiscussion": Starts the decision process and waits until a mod creates a vote via vote wizard.
     * - "decisionProcessVote": Waits until the associated vote is over.
     * - "endMeeting": Ends the meeting.
     */

    // This switch statement takes the current meetingPhase as conditional and expects its cases to advance the phase on their own.
    // That means that each case has to do the things necessary for the start of the respective "next" phase.
    switch (meetingPhase) {
        case "":
            meetingPhase = "waitForMeetingToStart";
            initWaitForMeetingStartWindow();
            break;

        case "waitForMeetingToStart":
            meetingPhase = "chooseVotingFormat";
            meetingHasStarted = true;
            sendNewVote(createVotingModeVote());
            break;

        case "chooseVotingFormat":
            meetingPhase = "chooseMods";
            sendNewVote(createVoteModVote());
            break;

        case "chooseMods":
            meetingPhase = "mainDiscussion";
            break;

        case "mainDiscussion":
            meetingPhase = "decisionProcessDiscussion";
            break;
        
        case "decisionProcessDiscussion":
            meetingPhase = "decisionProcessVote";
            alert("Finished discussing");
            break;

        case "decisionProcessVote":
            meetingPhase = "mainDiscussion";
            alert("Finished voting");
            break;
            

        default:
            break;
    }
}



function pushChatMessage(message) {
    chatMessages.push(message);
    updateChatMessagesHTML();
   
}



function initWaitForMeetingStartWindow() {
    switchOverlayWindow("waitForMeetingStart");

}


function updateWaitForMeetingStartWindowHTML() {
    /**
     * Updates the HTML of the wait for meeting start-window
     */
    $("#overlayNumberOfUsersReady").html(usersReadyForMeeting.length + "/" + userList.length + " Teilnehmer*Innen sind bereit.");
    if (usersReadyForMeeting.length == userList.length) {
        goToNextMeetingPhase();
        switchOverlayWindow("");
        chatMessages.push(new ChatMessage("", "Willkommen im Chat!", $.now(), "msgSys"));
    }
    if (meetingPhase != "" && meetingPhase != "waitForMeetingToStart") {
        switchOverlayWindow("");
    }
}

function updateUserListHTML() {
    /**
     * Updates the HTML of the user list.
     */
    var str = "";
    for (let i = 0; i < userList.length; i++) {
        str += userList[i].toString() + "<br/>";
    }
    $("#chatUsers").html(str);
}



function updateChatMessagesHTML() {
    /**
     * Updates the HTML chat message box.
     */ 
    
    var str = "";
    for (let i = 0; i < chatMessages.length; i++) {
        str += chatMessages[i].toString();
    }
    $("#chatMessages").html(str);
 
}


function updateVoteHTML(vote) {
    /**
     * Updates the HTML of the page to reflect the currently shown vote.
     * @param vote The current vote - should be currentVote.
     */

    // If there is no vote currently, empty the div and return
    if (vote == null) {
        $("#chatVoting").html("");
        return false;
    }
    
    // Create title and description divs and append them
    var s = "";
    s += "<div class='voteTitle'>" + vote.title + "</div>";
    s += "<div class='voteDesc'>" + vote.desc + "</div>";
    $("#chatVoting").html(s);


    // Construct a div for each VoteItem and attach a click event handler, then append it to the div.
    // The div has an ID equal to the VoteItem instance's id-variable.
    for (let i = 0; i < vote.voteItems.length; i++) {
        var item = vote.voteItems[i];
        $("#chatVoting").append(item.constructHTML(i));
        var id = "#" + item.id;

        $(id).on("click", function(event) {
            var _id = event.target.id;
            var _item = currentVote.getVoteItemByID(_id);
            if (_item == null) {
                alert ("Something went wrong - this vote item shouldn't be here...");
                return;
            }
            
            var selectionSuccess = _item.setIsSelected(!(_item.isSelected));
            if (!selectionSuccess) {
                alert("Couldn't select this item");
            }
            updateVoteHTML(vote);
            
        });
    }

    return true;
}

function getUserByUserID(userID) {
    /**
     * Returns the user with the given userID (given that he/she is in the userList).
     * @param userID id of the User to be found
     * @return the User instance with the given id or null if none was found
     */
    for (let i = 0; i < userList.length; i++) {
        if (userID == userList[i].id) {
            return userList[i];
        }
    }
    return null;
}

function getMeetingStateJSON() {
    /**
     * Returns the state of the room as JSON for syncing purposes (i.e. m.syncmeeting).
     * @return object containing the state of the room
     */

    var timestamp = syncTimestamp;
    var chatMessagesJSON = [];
    var userListJSON = [];
    var currentVoteJSON = "{}";
    
    for (let i = 0; i < chatMessages.length; i++) {
        var _chatmsg = chatMessages[i];
        chatMessagesJSON.push(_chatmsg.toJSON());
    }
    for (let i = 0; i < userList.length; i++) {
        var _user = userList[i];
        userListJSON.push(_user.toJSON());
    }
    if (currentVote != null) {
        currentVoteJSON = currentVote.toJSON();
    }
    
    var json = {
        timestamp: timestamp,
        currentVote: currentVoteJSON,
        chatMessages: chatMessagesJSON,
        userList: userListJSON,
        meetingPhase: meetingPhase
    };

    return json;
}


function generateRandomString(len=15, maxattempts=100) {
    /**
     * Constructs a random string which can be used as ID (if len is high enough).
     * This uses the "global" pastRandomStrings-list to avoid duplicated entries.
     * Naive string concatenation is fine because https://blog.codinghorror.com/the-sad-tragedy-of-micro-optimization-theater/
     * String generation function is taken from https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript (accessed 10.02.22)
     * @param len the length of the string to be generated.
     * @return the randomized string. If a string can't be generated after maxattempts tries, return an empty string.
     */

    // Try to generate a new random string and return it if successful
    for (let i = 0; i < maxattempts; i++) {
        var str = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, len);
        if (!pastRandomStrings.includes(str)) {
            pastRandomStrings.push(str);
            return str;
        }
    }

    // If no attempt was successful, append & return an empty string
    pastRandomStrings.push("");
    return "";
}


function getModList() {
    let modList = [];
    for (let i = 0; i < userList.length; i++) {
        if (userList[i].role == "mod") {
            modList.push(userList[i]);
        }
    }
    return modList;
}


function getVoteFromMessage(msg) {
    /**
     * Creates a new Vote instance from a received message's (parsed) body.
     * @param msg the body of the received message (unparsed json string)
     * @return the newly created vote
     */
    if (msg == "{}" || msg == "" || msg == {} || msg == null) {
        return null;
    }
    
    var parsedMsg = msg;//.currentVote;
    if ($.isEmptyObject(parsedMsg)) {
        return null;
    }
    
    var vote = new Vote(parsedMsg.title, parsedMsg.desc, [], parsedMsg.id, parsedMsg.mode, parsedMsg.effect.type);
    var voteItems = [];
    
    for (let j = 0; j < parsedMsg.voteItems.length; j++) {
        var item = new VoteItem(vote, parsedMsg.voteItems[j].desc, parsedMsg.voteItems[j].id, parsedMsg.voteItems[j].values);
        item.votes = new Set(parsedMsg.voteItems[j].votes);
        voteItems.push(item);
    }
    
    vote.voteItems = voteItems;
    console.log(vote);
    return vote;
}


function createVotingModeVote() {
    /**
     * Do not confuse votingmodevote with modvote :) (mod = moderator, mode = mode for voting)
     * Returns a Vote object representing a consensus vote that decides the main voting mode
     *  especially for mod voting.
     * Note that this is *always* consensus, as described in the paper.
     * @return a Vote object representing a voting mode vote.
     */
    var list = ["consensus", "absMajority", "relMajority"];
    var voteItems = [];
    var vote = new Vote("Wahlverfahren-Abstimmung", "Wähle ein Wahlverfahren für künftige Entscheidungen. Diese Abstimmung ist immer eine Konsensentscheidung.");
    vote.effectType = "votingMode";
    voteItems = [
        new VoteItem(vote, "Konsensverfahren", "", '{ "mode": "consensus" }'),
        new VoteItem(vote, "Absolute Mehrheit", "",  '{ "mode": "absMajority" }'),
        new VoteItem(vote, "Relative Mehrheit", "",  '{ "mode": "relMajority" }')
    ];
    vote.voteItems = voteItems;
    return vote;
}


function createVoteModVote(users=-1) {
    /**
     * Returns a Vote object representing a mod vote.
     * @param users List of Users that will be part of the vote. Defaults to the whole userList.
     * @return a Vote object representing a mod vote.
     */

    var list = userList;
    if (users == -1) {
        list = userList;
    }

    var voteItems = [];
    var vote = new Vote("Moderationswahl", "Wähle eine*n neue*n Moderator*in aus den vorgeschlagenen Personen!")
    vote.effectType = "voteMod";
    for (let i = 0; i < list.length; i++) {
        let user = list[i];
        let voteItem = new VoteItem(vote, user.name, "", { "userID": user.id });
        voteItems.push(voteItem);
    }
    vote.voteItems = voteItems;

    return vote;
}


function createRemoveModVote(users=-1) {
    /**
     * Returns a Vote object representing a mod removal vote.
     * @param users List of Users that will be part of the vote. Defaults to the mod list.
     * @return a Vote object representing a mod vote.
     */

    var modList = getModList();

    var list = users;
    if (users == -1) {
        list = modList;
    }

    var voteItems = [];
    var vote = new Vote("Abwahl der Moderation", "Wähle eine*n Moderator*in, die*der abgewählt werden soll.")
    vote.effectType = "removeMod";
    for (let i = 0; i < list.length; i++) {
        let user = list[i];
        let voteItem = new VoteItem(vote, user.name, "", { "userID": user.id });
        voteItems.push(voteItem);
    }
    vote.voteItems = voteItems;

    return vote;
}



$(document).ready(function() {
    
    
    // voteWizardInit();


    $("#overlayWindow").hide();
    $("#overlayNewVoteDiv").hide();
    $("#overlayWaitForMeetingDiv").hide();

    switchScreen("login");

    $("#loginButton").click(function() {
        let user = $("#usernameInput").val();
        var pass = $("#passwordInput").val();
        tryLogin(user, pass);
    });

    $("#registrationButton").click(function() {
        var user = $("#registrationUsernameInput").val();
        var pass = $("#registrationPasswordInput").val();
        var passRepeat = $("#registrationPasswordRepeatInput").val();
        tryRegister(user, pass, passRepeat);
    });


    $("#sendMessageButton").click(function() {
        sendChatMessage($("#messageTextInput").val());
    });
    

    $("#selectRegistrationScreenButton").click(function() {
        switchScreen("register");
    });

    $("#selectLoginScreenButton").click(function() {
        switchScreen("login");
    });

    $("#roomSelectButton").click(function() {
        tryJoinRoom($("#roomSelectInput").val());
    });

    $("#overlayWaitForMeetingReadyButton").click(function() {
        sendReadyForMeeting();
        
    })

    $("#sendVoteButton").click(function() {
        if (currentVote.isFinished) {
            return;
        }
        // Get voted items & send them
        var itemList = currentVote.getVotedItems();
        var itemIDList = [];
        for (let i = 0; i < itemList.length; i++) {
            itemIDList.push(itemList[i].id);
        }
        sendVotedItem(itemIDList, currentVote.id);
    });

    $("#finishVoteButton").click(function() {
        if (currentVote == null) {
            return;
        }
        var success = currentVote.finishVote();
        if (success) {
            sendVoteFinished(currentVote.id);
        }
        else {
            alert("Couldn't finish vote: Vote result does not match the requirements of its voting mode.");
        }
    });

    $("#startDecisionProcessButton").click(function() {
        if (meetingPhase == "mainDiscussion") {
            sendStartDecisionProcess();
        }
    });

    $("#newVoteButton").click(function() {
        voteWizardInit();
    });

    $("#modVoteButton").click(function() {
        sendNewVote(createVoteModVote());
    });

    $("#modRemoveButton").click(function() {
        sendNewVote(createRemoveModVote());
    });

    $("#votingModeVoteButton").click(function() {
        sendNewVote(createVotingModeVote());
    });
    

    $("#overlayWindowCloseButton").click(function() {
        switchOverlayWindow("");
    });

    $("#overlayNewVoteItemSubmit").click(function() {
        var desc = $("#overlayNewVoteItemInputDesc").val();
        var item = new VoteItem(voteInWizard, desc);
        voteInWizard.voteItems.push(item);
        voteWizardUpdate();
    });

    $("#overlayNewVoteSubmit").click(function() {
        if (meetingPhase != "decisionProcessDiscussion") {
            return;
        }
        voteWizardFinalize();
        sendNewVote(voteInWizard);
    });



    $(window).on("beforeunload", function() { 
        sendUserLeave();
    });


    $("#debugButton").click(function() {
        console.log("DEBUG:");
        sendChangeUserRole(myself.id, "mod");
        
    });


});


