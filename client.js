// Global vars
var roomID = "!HULaHFBnIxcwUEITua:gks-synapse";
var domain = "http://localhost:8008/";
var baseUrl = domain + "_matrix/client/v3"
var loginUrl = baseUrl + "/login";
var registerUrl = baseUrl + "/register?kind=user";
var longpollFrom = "END";

var accountInfo = {}; // Contains the account response from the API
var userInfo = {}; // Contains user info/stats (e.g. user name)

var eventLoopActive = true; // Whether to continue the event loop

var chatMessages = [];
var userList = [];

var currentVote = null;
var voteInWizard = null;

var meetingHasStarted = false;

var pastRandomStrings = []; // Contains a list of previously generated strings for the generateRandomString()

var syncTimestamp = Number.MAX_VALUE; // Contains the timestamp of the last accepted sync.
var originalTimestamp = Number.MAX_VALUE; // Contains the timestamp of when the user entered the room.

var myself = null; // User object representing the local user.

class User {
    constructor(name, joined=-1, id=-1) {
        /**
         * Represents a user in the room.
         * There should also be an instance for the local user him-/herself.
         * @param name Name of the user as given by the Matrix API
         * @param joined Timestamp of when the user joined. Default to $.now().
         * @param id Unique ID for this user. Defaults to a random ID.
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
        
    }

    toString() {
        return this.name;
    }

    toJSON() {
        return '{'
            + '"id": "' + this.id + '",'
            + '"name": "' + this.name + '",'
            + '"joined": "' + this.joined + '"'
            + '}';
    }
}

class ChatMessage {
    constructor(author, message, timestamp) {
        /**
         * Represents a single message in the chat.
         * @param author author of the message
         * @param message message body
         * @param timestamp timestamp of the message
         */
        this.author = author;
        this.message = message;
        this.timestamp = timestamp;
    }

    toString() {
        return "(" + this.timestamp + ") " + this.author + ": " + this.message;
    }

    toJSON() {
        return '{'
            + '"author": "' + this.author + '",'
            + '"message": "'+ this.message + '",'
            + '"timestamp": "' + this.timestamp + '"'
            + '}';
    }
}

class Vote {
    constructor(title, desc, voteItems = [], id = "", mode = "consensus") {
        /**
         * Represents a vote. This contains a list of voteItems, i.e. things you can vote for.
         * @param title Title of the vote. Should be short & concise.
         * @param desc Description of the vote. Shouldn't extend past 3-4 lines or smth.
         * @param voteItems List of voteItems, i.e. the things you can vote for. These can also be added later @TODO
         * @param id Unique identifier of this VoteItem (should be the same across each client for this VoteItem). If left blank, it will be auto-generated.
         * @param mode Voting mode. One of "consensus", "absMajority", "relMajority".
         */
        this.title = title;
        this.desc = desc;
        this.voteItems = voteItems;
        this.id = id;
        this.mode = mode;
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
        for (var i = 0; i < this.voteItems.length; i++) {
            voteItemsJSON.push(this.voteItems[i].toJSON());
        }

        var s = '{'
            + '"title": "' + this.title
            + '", "desc": "' + this.desc
            + '", "id": "' + this.id
            + '", "mode": "' + this.mode
            + '", "voteItems": [' + voteItemsJSON + ']'
            + ', "isFinished": ' + this.isFinished
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
        for (var i = 0; i < this.voteItems.length; i++) {
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
        for (var i = 0; i < this.voteItems.length; i++) {
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
        for (var i = 0; i < this.voteItems.length; i++) {
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

        var tally = [];
        var maxVotedItem = this.voteItems[0];
        // Get the tally for each voteItem and add a corresponding entry to the dict
        for (var i = 0; i < this.voteItems.length; i++) {
            var item = this.voteItems[i];
            var entry = {item: item.votes};
            tally.push(entry);
            if (item.votes.size > maxVotedItem.votes,size) {
                maxVotedItem = item;
            }
        }

        return {
            result: maxVotedItem,
            tally: tally
        };
    }

    finishVote() {
        /**
         * Ends the voting process for this Vote and gets the result.
         */
        this.isFinished = true;
        this.result = this.getResult();
        updateVoteHTML(currentVote);
    }
}

class VoteItem {
    constructor(vote, desc, id = "") {
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
        for (var i = 0; i < votesArr.length; i++) {
            votesStr += votesArr[i];
            if (i < votesArr.length - 1) {
                votesStr += ", ";
            }
        }
        return '{ "desc": "' + this.desc
         + '", "id": "' + this.id
         + '", "votes": [' + votesStr
         + ']}';
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
    
    switch(windowType) {
        case "voteWizard":
            $("#overlayNewVoteDiv").show();
            $("#overlayWindow").show();
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
    currentVote = voteInWizard;
    switchOverlayWindow("");
    // updateVoteHTML(currentVote);
    updateVoteHTML(voteInWizard);
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


function sendNewVote(vote) {
    /**
     * Sends a message to all participants signalling that a new vote has started
     * Should only be sent by moderators
     * @TODO mod verification
     * @param vote contains the vote to be sent.
     */

    var msg = {
        msgtype: "m.newvote",
        body: '{"currentVote": ' + vote.toJSON() + '}'
    };

    sendMessage(msg);
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
    for (var i = 0; i < votedItemID.length; i++) {
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
     * @param forward If true, polling will get the next message blocks. If false, it will get the previous ones (recursively until it hits a m.startmeeting).
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
    for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var result = JSON.parse(event.content.body);
        console.log(result);
     
        
        switch (event.content.msgtype) {
            case "m.text":
                var message = new ChatMessage(event.sender, result.text, event.origin_server_ts);
                pushChatMessage(message);
                break;


            case "m.userenter":
                var userData = result.user;
                var user = new User(userData.name, userData.joined, userData.id);
                userList.push(user);
                updateUserListHTML();
                break;
            
            case "m.userleave":
                var id = result.user.id;
                var _user = null;
                for (var j = 0; j < userList.length; j++) {
                    _user = userList[j];
                    if (_user.id == id) {
                        userList.splice(j, 1);
                    }
                }
                if (_user != null) {
                    console.log("User " + id + " left");
                    chatMessages.add(new ChatMessage("system", _user.name + " hat den Chat verlassen", $.now()))
                }
                else {
                    console.log("User that left wasn't in the user list");
                }
                updateUserListHTML();
                break;

            
            case "m.newvote":
                var vote = getVoteFromMessage(result.currentVote);
                currentVote = vote;
                updateVoteHTML(currentVote);
                break;
            

            case "m.votefinished":
                if (currentVote == null) {
                    // @TODO handle what happens here (re-request the current vote?)
                    break;
                }
                 
                if (currentVote.id != result.voteID) {
                    console.log("Vote finished received, but got an unknown vote ID");
                    sendSyncMeetingRequest();
                    break;
                }

                // alert("Vote finished!" + result.voteID);
                currentVote.finishVote();
                break;
            

            case "m.voteditem":
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
                for (var x = 0; x < currentVote.voteItems.length; x++) {
                    var _item = currentVote.voteItems[x];
                    // Check if the author is already in a voteItem's votes and if so, remove him*her from the voteItem's set
                    if (_item.votes.has(author)) {
                        _item.votes.delete(author);
                    }
                    // Add author to corresponding voteItem's votes
                    for (var j = 0; j < ids.length; j++) {
                        if (_item.id == ids[j]) {
                            _item.votes.add(author);
                        }
                    }
                }
                updateVoteHTML(currentVote);
                break;
            
            case "m.startmeeting":
                meetingHasStarted = true;
                break;


            case "m.syncmeetingrequest":
                if (result.timestamp > syncTimestamp) {
                    sendSyncMeeting();
                    console.log("Sent sync!");
                    
                }
                else {
                    console.log("Did not accept sync - request was ours or older than we are...");
                }
                break;
            
            case "m.syncmeeting":
                // Sync the meeting if the received msg's timestamp is older than our own.
                if (result.timestamp < syncTimestamp) {
                    console.log("Starting sync...");
                    var newChatMessages = [];
                    var newUserList = [];

                    for (var x = 0; x < result.chatMessages.length; x++) {
                        var msg = JSON.parse(result.chatMessages[i]);
                        newMsg = new ChatMessage(msg.author, msg.message, msg.timestamp);
                        newChatMessages.push(newMsg);
                    }

                    for (var x = 0; x < result.userList.length; x++) {
                        var msg = JSON.parse(result.userList[x]);
                        _user = new User(msg.name, msg.joined, msg.id);
                        newUserList.push(_user);
                    }

                    currentVote = getVoteFromMessage(JSON.parse(result.currentVote));
                    userList = newUserList;
                    chatMessages = newChatMessages;
                    syncTimestamp = result.timestamp;
                    updateChatMessagesHTML();
                    updateUserListHTML();
                }
                break;
            
            default:
                break;
        }
    }
}

function pushChatMessage(message) {
    chatMessages.push(message);
    updateChatMessagesHTML();
   
}


function updateUserListHTML() {
    /**
     * Updates the HTML of the user list.
     */
    var str = "";
    for (var i = 0; i < userList.length; i++) {
        str += userList[i].toString() + "<br/>";
    }
    $("#chatUsers").html(str);
}



function updateChatMessagesHTML() {
    /**
     * Updates the HTML chat message box.
     */ 
    
    var str = "";
    for (var i = 0; i < chatMessages.length; i++) {
        str += chatMessages[i].toString() + "<br/>";
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
    for (var i = 0; i < vote.voteItems.length; i++) {
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


function getMeetingStateJSON() {
    /**
     * Returns the state of the room as JSON for syncing purposes (i.e. m.syncmeeting).
     * @return object containing the state of the room
     */

    var timestamp = syncTimestamp;
    var chatMessagesJSON = [];
    var userListJSON = [];
    var currentVoteJSON = "{}";
    
    for (var i = 0; i < chatMessages.length; i++) {
        var _chatmsg = chatMessages[i];
        chatMessagesJSON.push(_chatmsg.toJSON());
    }
    for (var i = 0; i < userList.length; i++) {
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
        userList: userListJSON
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
    for (var i = 0; i < maxattempts; i++) {
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
    
    var vote = new Vote(parsedMsg.title, parsedMsg.desc, [], parsedMsg.id, parsedMsg.mode);
    var voteItems = [];
    
    for (var j = 0; j < parsedMsg.voteItems.length; j++) {
        var item = new VoteItem(vote, parsedMsg.voteItems[j].desc, parsedMsg.voteItems[j].id);
        item.votes = new Set(parsedMsg.voteItems[j].votes);
        voteItems.push(item);
    }
    
    vote.voteItems = voteItems;
    return vote;
}


$(document).ready(function() {
    
    
    voteWizardInit();

    switchScreen("login");


    $("#overlayWindow").hide();
    $("#overlayNewVoteDiv").hide();
    $("#debugButton").hide();

    $("#loginButton").click(function() {
        var user = $("#usernameInput").val();
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
        var msg = { 
            msgtype: "m.text",
            body: '{"text": "' + $("#messageTextInput").val() + '"}' };
        sendMessage(msg);
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

    $("#sendVoteButton").click(function() {
        if (currentVote.isFinished) {
            return;
        }
        // Get voted items & send them
        var itemList = currentVote.getVotedItems();
        var itemIDList = [];
        for (var i = 0; i < itemList.length; i++) {
            itemIDList.push(itemList[i].id);
        }
        sendVotedItem(itemIDList, currentVote.id);
    });

    $("#finishVoteButton").click(function() {
        if (currentVote == null) {
            return;
        }
        currentVote.finishVote();
        sendVoteFinished(currentVote.id);
    });

    $("#newVoteButton").click(function() {
        voteWizardInit();
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
        voteWizardFinalize();
        sendNewVote(currentVote);
    });



    $("#debugButton").click(function() {
        console.log("DEBUG:");
        sendUserLeave();
    });



    $(window).on("beforeunload", function() { 
        sendUserLeave();
    });
});